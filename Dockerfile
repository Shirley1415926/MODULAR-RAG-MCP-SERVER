FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PANDION_SETTINGS_PATH=config/pandion_cloud.yaml \
    PANDION_SPARSE_ONLY=1 \
    PORT=8080

WORKDIR /app

COPY requirements-pandion.txt ./
RUN pip install --no-cache-dir -r requirements-pandion.txt

COPY src ./src
COPY examples/pandion_demo ./examples/pandion_demo
COPY config/pandion_cloud.yaml ./config/pandion_cloud.yaml
COPY deployment/pandion_data/chroma ./data/db/chroma
COPY deployment/pandion_data/bm25 ./data/db/bm25/pandion_demo

EXPOSE 8080

CMD ["sh", "-c", "uvicorn src.pandion_demo.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
