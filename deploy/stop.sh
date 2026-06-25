#!/usr/bin/env bash
# Para e remove todos os processos da plataforma do pm2.
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pm2 delete mangaba-api mangaba-tunnel mangaba-awake 2>/dev/null || true
pm2 save --force 2>/dev/null || true
echo "Plataforma parada. (Ollama segue ativo, gerenciado pelo app Mangaba AI.)"
