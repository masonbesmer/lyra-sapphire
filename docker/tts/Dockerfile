# CPU-only on purpose. Piper is a small VITS model and synthesises an ack far faster than
# real time on a couple of cores, so putting it on the GPU would only make it fight the
# whisper sidecar for the same card.
#
# Python 3.11, pinned: piper-phonemize (piper-tts's espeak-ng binding) publishes manylinux
# wheels only up to cp311. Renovate bumped this to 3.14 within minutes of the sidecar landing
# (#734) and the build failed outright — pip finds no distribution at all, not even an sdist
# to fall back to. Renovate is switched off for this line in renovate.json; move it by hand,
# and only once piper-tts ships a binding with newer wheels.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
	piper-tts==1.2.0 \
	fastapi==0.115.6 \
	"uvicorn[standard]==0.34.0"

WORKDIR /app

COPY server.py .

# Voice weights land here, fetched on first boot. Mount a volume so a restart does not
# re-download them.
ENV PIPER_VOICES_DIR=/voices
RUN mkdir -p /voices

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
