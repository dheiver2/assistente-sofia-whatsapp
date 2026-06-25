#!/usr/bin/env bash
# Sobe TODA a plataforma sob o pm2 (backend + túnel + keep-awake). Idempotente.
set -euo pipefail
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p deploy/logs

command -v pm2 >/dev/null 2>&1 || { echo "Instalando pm2…"; npm install -g pm2; }

echo "→ Build do backend…";   npm run build
echo "→ Build do dashboard…"; npm --prefix dashboard run build

# Encerra qualquer processo solto (nohup) de antes, para o pm2 assumir sozinho.
pkill -9 -f "node dist/main" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:2785" 2>/dev/null || true
sleep 2

echo "→ Subindo no pm2…"
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save
echo "→ Aguardando o túnel…"; sleep 8
bash "$ROOT/deploy/status.sh"
