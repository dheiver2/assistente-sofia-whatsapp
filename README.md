# 🤖 Assistente Sofia — WhatsApp com IA Local

Assistente virtual de WhatsApp que responde automaticamente usando uma **IA open-source rodando 100% local** (via [Ollama](https://ollama.com)). A personalidade padrão é a **Sofia**, assistente comercial/consultiva — feminina, carinhosa e acolhedora — do **Prof. Dr. Dheiver Santos** ([DS Consultoria Avançada em IA](https://dheiver.com)), que atende e qualifica contatos enquanto ele não pode responder pessoalmente.

Construído sobre o [OpenWA](https://github.com/rmyndharis/OpenWA) (gateway de API para WhatsApp em NestJS), usando o engine **Baileys** (WebSocket, sem navegador).

---

## ✨ O que faz

- Conecta a um número de WhatsApp via QR code (engine Baileys — leve e estável em Docker).
- Responde **automaticamente** mensagens diretas (1:1) com respostas geradas por um **LLM local**.
- Personalidade **configurável por variável de ambiente** — sem mexer no código.
- Persona padrão **Sofia**: acolhe o contato, entende a necessidade, apresenta as soluções da DS Consultoria (machine learning, automação, chatbots, visão computacional, NLP, análise de dados, mentorias, treinamentos) e conduz para o próximo passo, sem inventar preços ou prazos.
- **Memória de conversa**: mantém o histórico de cada contato (persistido em disco), então acompanha o contexto, lembra do que foi dito antes — inclusive após reiniciar — e só se apresenta uma vez, sem ficar repetitiva.

## 🏗️ Como funciona

```
WhatsApp ──▶ OpenWA (NestJS, engine Baileys) ──▶ plugin auto-reply ──▶ Ollama (LLM local) ──▶ resposta
```

O plugin [`src/plugins/extensions/auto-reply`](src/plugins/extensions/auto-reply/index.ts) intercepta cada mensagem 1:1 recebida, chama o Ollama via HTTP e responde. Se o modelo estiver indisponível, envia uma mensagem de fallback.

## 📋 Pré-requisitos

- **Docker** + Docker Compose
- **[Ollama](https://ollama.com)** rodando no host, com um modelo pequeno baixado:
  ```bash
  ollama pull qwen2.5:7b-instruct
  ```
- Um número de WhatsApp para parear (de preferência dedicado ao bot).

## 🚀 Como rodar

```bash
# 1. Suba o container (build + start)
docker compose -f docker-compose.dev.yml up -d --build

# 2. Abra o dashboard e crie/inicie uma sessão
#    http://localhost:2785

# 3. Escaneie o QR code (WhatsApp ▸ Aparelhos conectados ▸ Conectar um aparelho)

# 4. Ative o plugin de auto-reply pelo dashboard (aba Plugins ▸ "Auto Reply")
```

Pronto: mande uma mensagem direta para o número conectado e a Sofia responde. 🎉

## ⚙️ Configuração

Variáveis no [`docker-compose.dev.yml`](docker-compose.dev.yml) (serviço `openwa`):

| Variável | Padrão | Descrição |
|---|---|---|
| `ENGINE_TYPE` | `baileys` | Engine do WhatsApp (Baileys = sem navegador). |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL do servidor Ollama (host). |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Modelo usado (ótimo português). Para menos RAM, use um menor como `qwen2.5:3b-instruct` (qualidade de texto cai um pouco). |
| `OLLAMA_TIMEOUT_MS` | `30000` | Timeout por requisição ao modelo. |
| `AI_HISTORY_TURNS` | `8` | Quantos turnos (pergunta+resposta) de memória manter por conversa. |
| `AI_SYSTEM_PROMPT` | *(persona Sofia)* | A personalidade/instruções da IA. |

O histórico de cada conversa fica em `data/plugins/auto-reply/hist-<chatId>.json` (fora do Git) e sobrevive a reinícios.

### Personalizar a persona

Basta editar `AI_SYSTEM_PROMPT` no compose e recriar o container (não precisa rebuild):

```bash
docker compose -f docker-compose.dev.yml up -d
```

### Trocar o modelo

```bash
ollama pull gemma2:2b
# edite OLLAMA_MODEL no compose para gemma2:2b
docker compose -f docker-compose.dev.yml up -d
```

## 🔒 Segurança

- Credenciais do WhatsApp, banco SQLite e `.env` ficam **fora do Git** (ver `.gitignore`): `data/`, `*.sqlite`, `.env`.
- A IA roda **localmente** via Ollama — nenhuma mensagem é enviada para serviços externos.
- O plugin responde **apenas** a mensagens diretas (1:1), ignorando grupos e mensagens enviadas pela própria conta.

## 🙏 Créditos

- Base: [OpenWA](https://github.com/rmyndharis/OpenWA) (MIT) — Yudhi Armyndharis & contribuidores.
- IA local: [Ollama](https://ollama.com) + modelos open-source.
- Persona & integração: **Prof. Dr. Dheiver Santos** — [dheiver.com](https://dheiver.com).

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
