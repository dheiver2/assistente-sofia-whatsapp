// pm2 ecosystem — deploy local da plataforma Mangaba AI (backend + túnel público + keep-awake).
// Ollama é gerenciado pelo app Mangaba AI; NÃO entra aqui.
// Uso: pm2 start deploy/ecosystem.config.cjs && pm2 save   (ou: bash deploy/start.sh)
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LOGS = path.join(ROOT, 'deploy', 'logs');
const HOME = process.env.HOME;

module.exports = {
  apps: [
    {
      // API NestJS + dashboard empacotado (porta 2785). Carrega .env via dotenv (cwd = ROOT).
      name: 'mangaba-api',
      cwd: ROOT,
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1, // Baileys exige instância única por sessão
      autorestart: true,
      max_memory_restart: '1500M',
      out_file: path.join(LOGS, 'api.out.log'),
      error_file: path.join(LOGS, 'api.err.log'),
      time: true,
    },
    {
      // Túnel público (Cloudflare quick tunnel). A URL muda a cada start — veja em deploy/status.sh.
      name: 'mangaba-tunnel',
      script: `${HOME}/.local/bin/cloudflared`,
      args: 'tunnel --url http://localhost:2785',
      interpreter: 'none',
      autorestart: true,
      restart_delay: 3000,
      out_file: path.join(LOGS, 'tunnel.out.log'),
      error_file: path.join(LOGS, 'tunnel.out.log'),
      time: true,
    },
    {
      // Mantém o Mac acordado (com a tampa aberta) para o link seguir acessível.
      // Não quer? remova com: pm2 delete mangaba-awake
      name: 'mangaba-awake',
      script: '/usr/bin/caffeinate',
      args: '-dimsu',
      interpreter: 'none',
      autorestart: true,
      out_file: path.join(LOGS, 'awake.log'),
      error_file: path.join(LOGS, 'awake.log'),
    },
  ],
};
