FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 YOLO_OFFLINE=1 YOLO_AUTOINSTALL=False
# opencv (an ultralytics dependency) needs these shared libraries even for exports
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
WORKDIR /app
COPY converter.py worker.py ./
# Non-root; the root filesystem is read-only at run time, scratch space is tmpfs (see docker-compose.yml).
RUN useradd --system --uid 10001 --no-create-home conv
USER conv
ENV SPOOL_DIR=/spool TMPDIR=/work HOME=/work YOLO_CONFIG_DIR=/work/.cfg
CMD ["python", "converter.py"]
