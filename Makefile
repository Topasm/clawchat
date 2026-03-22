.PHONY: setup setup-frontend setup-backend dev dev-frontend dev-backend test typecheck build docker docker-ollama clean

# First-time setup: install all dependencies
setup: setup-frontend setup-backend
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example — edit it with your settings")

setup-frontend:
	npm install

setup-backend:
	cd server && python3 -m venv venv && . venv/bin/activate && pip install -r requirements.txt

# Run both frontend and backend in parallel (requires setup first)
dev:
	@echo "Starting frontend (port 5173) and backend (port 8000)..."
	npx concurrently --names "web,api" --prefix-colors "cyan,yellow" \
		"npm run dev" \
		"cd server && . venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000"

dev-frontend:
	npm run dev

dev-backend:
	cd server && . venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Testing and checks
test:
	npm run test

typecheck:
	npm run typecheck

# Production builds
build:
	npm run build

# Docker
docker:
	docker compose up --build -d

docker-ollama:
	docker compose --profile ollama up --build -d

clean:
	rm -rf node_modules dist dist-electron server/venv server/__pycache__ server/data
