#!/usr/bin/env bash
# Mostra o estado da plataforma: processos, link público, login e sessões.
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pm2 status 2>/dev/null || true
echo ""
echo "─────────────────────────────────────────────"
API=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:2785/api/sessions -H "X-API-Key: $(cat "$ROOT/data/.api-key" 2>/dev/null)" 2>/dev/null || echo "—")
echo "🖥️  Local:        http://localhost:2785   (API: HTTP $API)"
URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$ROOT/deploy/logs/tunnel.out.log" 2>/dev/null | tail -1)
echo "🔗 Link público:  ${URL:-(o túnel ainda está subindo — rode 'bash deploy/status.sh' de novo)}"
echo "🔑 Login:         admin / mangaba2026"
echo "📋 Logs:          pm2 logs   |   pm2 logs mangaba-api"
echo "─────────────────────────────────────────────"
