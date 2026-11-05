# Plant-side edge bridge: polls OT adapters (sim/modbus/s7/opcua), runs the
# vision pipeline, and publishes over MQTT to the broker. The ENV block holds
# dev-broker defaults (plaintext mosquitto:1883, a non-UUID EDGE_ID) — the
# compose stack / production env overrides them (TLS 8883, real UUIDs, or
# ENROLL_CODE + WDS_URL for first-start enrollment).
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

# Run unprivileged; the state dir must be writable by this user — it holds
# identity.json, the sealed cfg cache, and the vision audit spool.
RUN useradd --create-home --uid 10001 edge && mkdir -p /var/lib/wds-edge && chown edge /var/lib/wds-edge
USER edge

CMD ["python", "-m", "edge_bridge.main"]
