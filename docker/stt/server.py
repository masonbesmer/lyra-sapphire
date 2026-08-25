"""Minimal OpenAI-compatible faster-whisper server.

Deliberately small: one transcription endpoint and a health check. The bot posts a single
bounded utterance and waits for one answer, so there is no streaming, no queueing and no
session state to get wrong.
"""

import io
import os
import time

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "small.en")
DEVICE = os.environ.get("DEVICE", "cuda")
# float16 on the 2080 Super (compute capability 7.5). NEVER bfloat16 — it is unsupported
# there and silently falls back to float32, which is slower for no gain. int8 for CPU.
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "float16")
BEAM_SIZE = int(os.environ.get("BEAM_SIZE", "1"))

app = FastAPI()

# Loaded once at import and kept resident. Cold-loading per request would dwarf the
# inference time and blow the latency budget.
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "device": DEVICE, "compute_type": COMPUTE_TYPE}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...)):
    started = time.monotonic()
    try:
        audio = io.BytesIO(await file.read())
        segments, info = model.transcribe(
            audio,
            beam_size=BEAM_SIZE,
            # The bot sends one already-endpointed utterance, so let whisper treat it as a
            # single unit. Its own VAD would only re-cut what has already been cut.
            vad_filter=False,
            condition_on_previous_text=False,
        )
        text = "".join(segment.text for segment in segments).strip()
        return {
            "text": text,
            "language": info.language,
            "duration": info.duration,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 - never take the server down for one bad request
        return JSONResponse(status_code=500, content={"error": str(exc), "text": ""})
