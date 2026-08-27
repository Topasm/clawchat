#!/bin/bash
# ClawChat Server - Easy Run Script

# Get the directory of this script and cd into it
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=== ClawChat Server Setup & Run ==="

# 1. Install the exact dependency set recorded in uv.lock.
if ! command -v uv >/dev/null 2>&1; then
    echo "❌ uv 0.10.2 or newer is required: https://docs.astral.sh/uv/"
    exit 1
fi

echo "➡️ Synchronizing locked dependencies..."
uv sync --locked --quiet

# 2. Setup environment variables
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "➡️ Creating default .env file..."
        cp .env.example .env
    else
        echo "⚠️ Warning: .env.example not found."
    fi
fi

# 3. Run the server
echo "✅ Starting ClawChat server..."
echo "API Docs available at: http://localhost:8000/docs"
echo "--------------------------------------------------------"
exec uv run --locked uvicorn main:app --reload --port 8000 --host 0.0.0.0
