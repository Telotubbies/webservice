FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 MODEL_DIR=/models PORT=9000
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
# CPU by default. GPU gateways: --build-arg ORT_PACKAGE=onnxruntime-gpu (CUDA/TensorRT) on a CUDA base image;
# Intel iGPU/VPU: --build-arg ORT_PACKAGE=onnxruntime-openvino. Providers are picked at run time, best first.
ARG ORT_PACKAGE=onnxruntime
COPY requirements.txt .
RUN grep -v "^onnxruntime" requirements.txt > r.txt && pip install --no-cache-dir -r r.txt && pip install --no-cache-dir "${ORT_PACKAGE}==1.22.0"
WORKDIR /app
COPY server ./server
RUN useradd --system --uid 10001 --no-create-home ms && mkdir -p /models && chown ms /models
USER ms
EXPOSE 9000
CMD ["python", "-m", "server.app"]
