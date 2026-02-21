#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/scripts/deploy.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deploy env file: $ENV_FILE"
  echo "Copy scripts/deploy.env.example to scripts/deploy.env and fill values."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${DEPLOY_HOST:-}" || -z "${DEPLOY_USER:-}" ]]; then
  echo "Missing DEPLOY_HOST or DEPLOY_USER in $ENV_FILE"
  exit 1
fi

DEPLOY_PORT="${DEPLOY_PORT:-22}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000$HEALTH_PATH}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"

ssh_opts=(-p "$DEPLOY_PORT")
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  ssh_opts+=(-i "$DEPLOY_SSH_KEY")
fi

echo "Running health check on $DEPLOY_USER@$DEPLOY_HOST"
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "curl -fsS '$HEALTH_URL'"
echo
