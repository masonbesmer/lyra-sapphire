# GPU by default, mirroring the stt sidecar. Kokoro is an 82M-parameter model: it runs on
# CPU, but a spoken ack then takes longer than it does to say, and it fought the old Piper
# image's "faster than real time on two cores" claim in practice. On the 2080 it synthesises
# in a fraction of real time and leaves whisper (small.en, ~1 GB) most of the card.
#
# Override with --build-arg BASE_IMAGE=ubuntu:22.04 for a CPU-only build; nothing here needs
# CUDA at build time, only at run time. The cudnn-runtime base matches stt so the two images
# share layers.
ARG BASE_IMAGE=nvidia/cuda:12.9.2-cudnn-runtime-ubuntu22.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONUNBUFFERED=1

# espeak-ng is Kokoro's grapheme-to-phoneme fallback (via misaki) for anything not in its
# dictionary — numbers, names, coined words. Without it synthesis raises on the first such
# token instead of falling back.
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 \
	python3-pip \
	espeak-ng \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The PyPI torch wheel for linux/x86_64 is the CUDA 12.x build by default and ships its own
# CUDA libraries, so it needs only the host driver (injected via CDI) at run time, not the
# base image's toolkit. kokoro pulls torch/transformers/misaki transitively; pin the top
# two so a Renovate bump cannot swap the model runtime out from under a tested image.
RUN pip3 install --no-cache-dir \
	kokoro==0.9.4 \
	"numpy<2" \
	fastapi==0.115.6 \
	"uvicorn[standard]==0.34.0"

COPY server.py .

# Model weights and voice tensors land here on first boot (HF repo hexgrad/Kokoro-82M).
# Mount a volume so a container restart does not re-download them.
ENV HF_HOME=/voices
RUN mkdir -p /voices

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
