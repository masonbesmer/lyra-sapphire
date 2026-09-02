"""Minimal Kokoro text-to-speech server.

The mirror image of the STT sidecar, and deliberately just as small: one synthesis endpoint
and a health check. The bot posts one short acknowledgement and waits for one WAV back, so
there is no streaming, no queueing and no session state to get wrong.

Kokoro is an 82M-parameter model that runs on the GPU alongside whisper. Audio comes out at
its native 24 kHz mono; resampling to Discord's 48 kHz stereo happens bot-side through
ffmpeg, which is already a dependency there — adding a second resampler here would only be
another thing to keep in sync.
"""

import io
import logging
import os
import time
import wave

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from kokoro import KPipeline
from pydantic import BaseModel

# Any voice bundled in hexgrad/Kokoro-82M (af_heart, af_bella, am_michael, bf_emma, …). The
# first letter is the language/accent, which KPipeline needs separately for phonemisation.
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
LANG_CODE = os.environ.get("KOKORO_LANG_CODE", VOICE[:1])
# >1 speeds speech up, <1 slows it down. Acks are short and usually have music playing over
# them, so the default rate is about right.
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))
# Load-bearing as a safety net, like stt's DEVICE: passing "cuda" explicitly makes torch
# raise at load if the GPU is not visible in the container, rather than quietly synthesising
# on CPU while looking GPU-configured. Set KOKORO_DEVICE=cpu for the CPU-only build.
DEVICE = os.environ.get("KOKORO_DEVICE", "cuda")

SAMPLE_RATE = 24_000

logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# Loaded once at import and kept resident, like the whisper model next door. Cold-loading per
# request would dwarf synthesis and blow the latency budget. Weights download to HF_HOME on
# the first call for a given voice.
pipeline = KPipeline(lang_code=LANG_CODE, device=DEVICE)


def render(text: str) -> np.ndarray:
    """Runs the full pipeline and returns one float32 waveform in [-1, 1].

    Kokoro yields one segment per sentence-ish chunk; an ack is capped at 240 chars upstream
    so this is almost always a single chunk, but concatenate anyway so a two-sentence ack
    does not come out truncated.
    """
    chunks: list[np.ndarray] = []
    for result in pipeline(text, voice=VOICE, speed=SPEED):
        audio = getattr(result, "audio", None)
        if audio is None:
            continue
        chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
    if not chunks:
        raise RuntimeError("pipeline produced no audio")
    return np.concatenate(chunks) if len(chunks) > 1 else chunks[0]


def to_wav(audio: np.ndarray) -> bytes:
    """PCM-16 mono WAV, so the bot gets a container with the sample rate in its header rather
    than raw PCM it has to be told the rate of out of band."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


# One synthesis at boot so the first real ack does not eat CUDA kernel warm-up. Failure here
# is not fatal — health still reports, and the first request surfaces the real error.
try:
    _warm = time.monotonic()
    render("Ready.")
    logger.info("kokoro warm-up done in %d ms", round((time.monotonic() - _warm) * 1000))
except Exception:  # noqa: BLE001
    logger.exception("kokoro warm-up failed")


class SpeechRequest(BaseModel):
    input: str


@app.get("/health")
def health():
    return {"status": "ok", "voice": VOICE, "device": DEVICE, "sample_rate": SAMPLE_RATE}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    started = time.monotonic()
    try:
        wav = to_wav(render(request.input))
        return Response(
            content=wav,
            media_type="audio/wav",
            headers={"X-Elapsed-Ms": str(round((time.monotonic() - started) * 1000))},
        )
    except Exception:  # noqa: BLE001 - never take the server down for one bad request
        # Logged here rather than returned. The caller is the bot, which can do nothing with a
        # traceback but log it again, and anything else that can reach this port should not be
        # handed our stack frames.
        logger.exception("synthesis failed")
        return JSONResponse(status_code=500, content={"error": "synthesis failed"})
