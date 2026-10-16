FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./alembic.ini
COPY migrations ./migrations
COPY app ./app
COPY alarm_rules.yaml ./alarm_rules.yaml

# Non-root: a compromised process shouldn't own the container filesystem.
RUN useradd --system --uid 10001 --no-create-home app \
 && mkdir -p /data/videos /data/models /data/convert && chown app /data/videos /data/models /data/convert
USER app

ENV MQTT_HOST=mosquitto \
    MQTT_PORT=1883 \
    SITE=plant1 \
    EDGE_ID=edge1 \
    CORS_ORIGIN=http://localhost:5173

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
