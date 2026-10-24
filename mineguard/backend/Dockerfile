FROM python:3.12.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/mineguard/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && useradd --create-home --uid 10001 mineguard
COPY backend/app ./app
COPY data /opt/mineguard/data
USER mineguard
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/live', timeout=2)"
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
