#!/usr/bin/env bash
# Deploy Paperclip to production (Hetzner CAX31 at 116.203.202.111)
#
# Prerequisites:
#   1. SSH access: ssh root@116.203.202.111
#   2. Deploy key added to GitHub repo
#   3. Docker installed on server
#   4. .env file created at /opt/paperclip/.env
#
# Usage: bash scripts/deploy-production.sh

set -euo pipefail

SERVER="root@116.203.202.111"
REMOTE_DIR="/opt/paperclip"
REPO_URL="git@github.com:$(git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||').git"

echo "=== Paperclip Production Deploy ==="
echo "Server: $SERVER"
echo "Remote: $REMOTE_DIR"
echo ""

# Step 1: Ensure directories exist
echo "[1/5] Setting up directories..."
ssh "$SERVER" "mkdir -p $REMOTE_DIR/repo"

# Step 2: Clone or pull
echo "[2/5] Syncing repo..."
ssh "$SERVER" "
  if [ -d $REMOTE_DIR/repo/.git ]; then
    cd $REMOTE_DIR/repo && git fetch origin && git reset --hard origin/main
  else
    git clone $REPO_URL $REMOTE_DIR/repo
  fi
"

# Step 3: Check .env exists
echo "[3/5] Checking .env..."
ssh "$SERVER" "
  if [ ! -f $REMOTE_DIR/.env ]; then
    echo 'ERROR: $REMOTE_DIR/.env not found. Create it first:'
    echo '  BETTER_AUTH_SECRET=\$(openssl rand -hex 32)'
    echo '  POSTGRES_PASSWORD=\$(openssl rand -hex 16)'
    exit 1
  fi
"

# Step 4: Build and start
echo "[4/5] Building and starting containers..."
ssh "$SERVER" "
  cd $REMOTE_DIR/repo
  ln -sf $REMOTE_DIR/.env .env
  docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
"

# Step 5: Health check
echo "[5/5] Checking health..."
sleep 5
ssh "$SERVER" "curl -sf http://localhost:3100/api/health | jq . || echo 'Waiting for startup...'"

echo ""
echo "=== Deploy complete ==="
echo "URL: https://paperclip.tennismafia.co.uk"
