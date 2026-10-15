FROM python:3.12-slim

WORKDIR /app

# System deps needed by Playwright's Chromium (fonts, codecs, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Installs the Chromium binary itself plus its OS-level dependencies
RUN playwright install --with-deps chromium

COPY . .

# Railway injects $PORT at runtime; default 8000 for local `docker run`
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
