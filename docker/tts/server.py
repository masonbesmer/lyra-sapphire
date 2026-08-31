"""Minimal Piper text-to-speech server.

The mirror image of the STT sidecar, and deliberately just as small: one synthesis endpoint
and a health check. The bot posts one short acknowledgement and waits for one WAV back, so
there is no streaming, no queueing and no session state to get wrong.

Audio comes out at the voice's native rate (22.05 kHz mono for a `medium` voice). Resampling
to Discord's 48 kHz stereo happens bot-side through ffmpeg, which is already a dependency
there — adding a second resampler here would only be another thing to keep in sync.
"""

import io
import logging
import os
import time
import urllib.request
import wave
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from piper import PiperVoice
from pydantic import BaseModel

VOICE = os.environ.get("PIPER_VOICE", "en_US-amy-medium")
VOICES_DIR = Path(os.environ.get("PIPER_VOICES_DIR", "/voices"))
# >1 slows speech down, <1 speeds it up. Acks are short and the channel usually has music
# playing over them, so the default rate is about right.
LENGTH_SCALE = float(os.environ.get("PIPER_LENGTH_SCALE", "1.0"))

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

logger = logging.getLogger("uvicorn.error")


def fetch_voice(name: str) -> tuple[Path, Path]:
    """Downloads `name`.onnx and its config on first boot, then reuses the volume copy.

    Voice names encode their own path: en_US-amy-medium lives under en/en_US/amy/medium/.
    """
    locale, speaker, quality = name.split("-")
    remote = f"{HF_BASE}/{locale.split('_')[0]}/{locale}/{speaker}/{quality}/{name}"

    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for suffix in (".onnx", ".onnx.json"):
        local = VOICES_DIR / f"{name}{suffix}"
        if not local.exists():
            # Straight to the final path only on success: a half-written file left by an
            # interrupted download would be treated as cached on the next boot.
            partial = local.with_suffix(local.suffix + ".part")
            urllib.request.urlretrieve(f"{remote}{suffix}", partial)
            partial.rename(local)
        paths.append(local)
    return paths[0], paths[1]


app = FastAPI()

# Loaded once at import and kept resident, like the whisper model next door. Cold-loading
# per request would dwarf synthesis and blow the latency budget.
model_path, config_path = fetch_voice(VOICE)
voice = PiperVoice.load(str(model_path), config_path=str(config_path))


class SpeechRequest(BaseModel):
    input: str


@app.get("/health")
def health():
    return {"status": "ok", "voice": VOICE, "sample_rate": voice.config.sample_rate}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    started = time.monotonic()
    try:
        buffer = io.BytesIO()
        # Piper writes the RIFF header itself, so the bot gets a container rather than raw
        # PCM and does not have to be told the sample rate out of band.
        with wave.open(buffer, "wb") as wav:
            voice.synthesize(request.input, wav, length_scale=LENGTH_SCALE)
        return Response(
            content=buffer.getvalue(),
            media_type="audio/wav",
            headers={"X-Elapsed-Ms": str(round((time.monotonic() - started) * 1000))},
        )
    except Exception:  # noqa: BLE001 - never take the server down for one bad request
        # Logged here rather than returned. The caller is the bot, which can do nothing with a
        # traceback but log it again, and anything else that can reach this port should not be
        # handed our stack frames.
        logger.exception("synthesis failed")
        return JSONResponse(status_code=500, content={"error": "synthesis failed"})
