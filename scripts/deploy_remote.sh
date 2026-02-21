#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/scripts/deploy.env}"
AUTO_YES="${AUTO_YES:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deploy env file: $ENV_FILE"
  echo "Copy scripts/deploy.env.example to scripts/deploy.env and fill values."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

required_vars=(
  DEPLOY_HOST
  DEPLOY_USER
  REMOTE_APP_DIR
  PROCESS_MANAGER
)

for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env var: $var"
    exit 1
  fi
done

DEPLOY_PORT="${DEPLOY_PORT:-22}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000$HEALTH_PATH}"
RSYNC_EXCLUDES_FILE="${RSYNC_EXCLUDES_FILE:-$ROOT_DIR/scripts/rsync_excludes.txt}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"

ssh_opts=(-p "$DEPLOY_PORT")
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  ssh_opts+=(-i "$DEPLOY_SSH_KEY")
fi
ssh_cmd="ssh -p $DEPLOY_PORT"
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  ssh_cmd+=" -i \"$DEPLOY_SSH_KEY\""
fi

if [[ ! -f "$RSYNC_EXCLUDES_FILE" ]]; then
  cat > "$RSYNC_EXCLUDES_FILE" <<'EOF'
.git
node_modules
.DS_Store
*.log
EOF
fi

echo "Deploy target: $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_APP_DIR"
echo "Process manager: $PROCESS_MANAGER"
echo "Health URL: $HEALTH_URL"
echo

if [[ "$AUTO_YES" != "1" ]]; then
  read -r -p "Proceed with deploy and restart? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

echo "Syncing files..."
rsync -az --delete \
  --exclude-from "$RSYNC_EXCLUDES_FILE" \
  -e "$ssh_cmd" \
  "$ROOT_DIR/" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_APP_DIR/"

echo "Installing production dependencies..."
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
  "cd '$REMOTE_APP_DIR' && npm ci --omit=dev"

restart_cmd=""
case "$PROCESS_MANAGER" in
  pm2)
    if [[ -z "${PM2_APP_NAME:-}" ]]; then
      echo "Missing PM2_APP_NAME for PROCESS_MANAGER=pm2"
      exit 1
    fi
    restart_cmd="pm2 restart '$PM2_APP_NAME' --update-env"
    ;;
  systemd)
    if [[ -z "${SYSTEMD_SERVICE:-}" ]]; then
      echo "Missing SYSTEMD_SERVICE for PROCESS_MANAGER=systemd"
      exit 1
    fi
    restart_cmd="sudo systemctl restart '$SYSTEMD_SERVICE'"
    ;;
  node)
    restart_cmd="pkill -f 'node server.js' || true; cd '$REMOTE_APP_DIR' && nohup node server.js >/tmp/aegean-voice.log 2>&1 &"
    ;;
  *)
    echo "Unsupported PROCESS_MANAGER=$PROCESS_MANAGER (use pm2|systemd|node)"
    exit 1
    ;;
esac

echo "Restarting service..."
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$restart_cmd"

echo "Checking health..."
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
  "curl -fsS '$HEALTH_URL'"

echo
echo "Deploy completed successfully."
