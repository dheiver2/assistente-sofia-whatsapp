# Deploy local — Mangaba AI (pet shop / Super Pet)

Plataforma rodando **nesta máquina** sob o **pm2** (gerenciador de processos): backend + dashboard
(porta 2785), túnel público e keep-awake. O Ollama é gerenciado pelo app Mangaba AI à parte.

> Diretório vivo do deploy: este worktree. Os dados (banco `openwa`, `.env`, credenciais do WhatsApp
> em `data/baileys`, `data/.api-key`) ficam aqui. Não apague esta pasta sem backup.

## Comandos

```bash
bash deploy/start.sh     # build + sobe tudo no pm2 (idempotente)
bash deploy/status.sh    # processos + link público + login + sessões
bash deploy/stop.sh      # para tudo (Ollama continua)
pm2 logs                 # logs ao vivo (ou: pm2 logs mangaba-api)
pm2 restart mangaba-api  # reinicia só o backend
```

## Acesso
- **Local:** http://localhost:2785
- **Link público:** sai no `deploy/status.sh` (muda a cada start — Cloudflare quick tunnel)
- **Login:** `admin` / `mangaba2026`  (troque em `.env`: `DASHBOARD_PASSWORD`, depois `pm2 restart mangaba-api`)

## Atualizar (após mudar o código)
```bash
git pull && bash deploy/start.sh    # rebuild + reload sem downtime perceptível
```

## Sobreviver a reboot da máquina
Uma vez só (o pm2 imprime um comando `sudo` para você rodar):
```bash
pm2 startup
pm2 save
```
Depois de reiniciar o Mac, o pm2 sobe o backend e o túnel sozinho.

## Notas
- **Sleep / tampa fechada:** `mangaba-awake` (caffeinate) mantém o Mac acordado com a tampa **aberta**.
  Com a tampa fechada e sem monitor externo, o Mac dorme e o link cai. Não quer o keep-awake?
  `pm2 delete mangaba-awake && pm2 save`.
- **Link estável (URL fixa):** o quick tunnel troca a URL a cada start. Para uma URL permanente, use um
  *named tunnel* do Cloudflare (precisa de um domínio) ou faça deploy num host sempre-ligado (VPS).
- **Ollama:** se o modelo cair, é pelo app Mangaba AI — reabra o app. O backend usa `qwen2.5:14b-instruct`
  na sessão Super Pet (configurável na aba IA da sessão).
