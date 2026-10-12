FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    MQTT_HOST=mosquitto \
    MQTT_PORT=1883 \
    EDGE_ID=edge1 \
    SITE=plant1 \
    ADAPTER=sim \
    POLL_MS=1000 \
    EDGE_CLOCK_SKEW_MS=0 \
    TAGS_CONFIG=/app/tags.yaml

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY edge_bridge ./edge_bridge
COPY tags.yaml ./tags.yaml

RUN useradd --create-home --uid 10001 edge
USER edge

CMD ["python", "-m", "edge_bridge.main"]
