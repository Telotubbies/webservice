FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 YOLO_OFFLINE=1 YOLO_AUTOINSTALL=False
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
