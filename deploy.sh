#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Starting deployment..."

# Navigate to the app directory (use absolute path for safety)
cd /home/clogged/clogged-server || { echo "Failed to cd into app directory"; exit 1; } # Replace your_username

# Pull the latest changes from the main branch
echo "Pulling latest code..."
git fetch origin staging # Fetch latest changes from remote main branch
git reset --hard origin/staging # Force local main to match remote main (discard local changes)
git clean -fd # Remove untracked files and directories

# Load environment variables from .env (Docker Compose does this, but useful if build args needed them)
# export $(grep -v '^#' .env | xargs)

# Rebuild services if their source code/Dockerfiles changed
echo "Building Docker images..."
docker compose -f docker-compose.staging.yml build --no-cache # Use --no-cache cautiously, can slow builds

# Bring services down, remove orphans, and bring them up with new images/config
echo "Restarting services..."
docker compose -f docker-compose.staging.yml up -d --remove-orphans

# Prune unused Docker images to save space (optional)
echo "Pruning old Docker images..."
docker image prune -f # -a removes unused and dangling images, -f forces

echo "Deployment finished successfully!"