FROM python:3.12-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Run alembic migrations (if available) then start the server.
# Tables are also auto-created via Base.metadata.create_all in main.py.
CMD ["sh", "-c", "alembic upgrade head 2>/dev/null; uvicorn main:app --host 0.0.0.0 --port 8000"]
