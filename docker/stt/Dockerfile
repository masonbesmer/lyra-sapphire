# CUDA runtime with cuDNN — faster-whisper (CTranslate2) needs both.
# Override with --build-arg BASE_IMAGE=ubuntu:22.04 for a CPU-only build; nothing in the
# image needs CUDA at build time, only at run time.
ARG BASE_IMAGE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
	PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 \
	python3-pip \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip3 install --no-cache-dir \
	faster-whisper==1.1.1 \
	fastapi==0.115.6 \
	"uvicorn[standard]==0.34.0" \
	python-multipart==0.0.20 \
	# faster-whisper 1.1.1 imports requests without declaring it, so the server dies at
	# import with ModuleNotFoundError unless it is installed explicitly.
	requests==2.32.3

COPY server.py .

# Model weights land here. Mount a volume so a container restart does not re-download.
ENV HF_HOME=/models
RUN mkdir -p /models

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
