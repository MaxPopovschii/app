# 🚀 Quick Start Guide - Mini Crawler

## Prerequisiti
- Docker e Docker Compose installati
- Git (opzionale, per gestire i commit)

## Setup Rapido

### 1. Inizializza il repository Git (opzionale ma consigliato)
```bash
cd app
./scripts/init-git.sh
```

Questo creerà una storia di commit pulita e organizzata come richiesto nella specifica.

### 2. Build del Frontend
```bash
cd app
yarn build-frontend
```

Questo comando:
- Installa le dipendenze del frontend
- Compila Vue 3 + TypeScript
- Copia i file compilati in `api/public/`

### 3. Avvia lo stack Docker
```bash
docker compose up --build
```

Questo avvierà:
- **MongoDB** sulla porta 27017
- **RabbitMQ** sulla porta 5672 (UI su 15672)
- **API** sulla porta 8080
- **Worker** in background

### 4. Accedi all'applicazione

- **Frontend**: http://localhost:8080
- **RabbitMQ Management**: http://localhost:15672 (username: `guest`, password: `guest`)
- **Health Check**: http://localhost:8080/healthz

## Test dell'applicazione

### Test Manuale
1. Apri http://localhost:8080
2. Inserisci un URL (es. `https://example.com`)
3. Clicca "Crawl & Analyze"
4. Attendi il risultato (10-30 secondi)

### Test E2E Automatizzati
```bash
cd app
yarn test:e2e
```

Questo testerà:
- ✅ Crawl di URL multipli
- ✅ Idempotenza (stesso URL → stesso UID)
- ✅ Robots.txt compliance
- ✅ Gestione errori

## Comandi Utili

### Vedere i log
```bash
# Tutti i servizi
docker compose logs -f

# Solo API
docker compose logs -f api

# Solo Worker
docker compose logs -f worker
```

### Fermare lo stack
```bash
docker compose down
```

### Fermare e rimuovere i volumi (reset completo)
```bash
docker compose down -v
```

### Rebuild completo
```bash
docker compose down
docker compose up --build
```

## Sviluppo Locale (senza Docker)

Se preferisci sviluppare localmente:

### 1. Avvia MongoDB e RabbitMQ
```bash
# MongoDB
docker run -d -p 27017:27017 mongo:7

# RabbitMQ
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

### 2. Configura environment
Copia `.env.example` in `.env` e modifica se necessario:
```bash
cp .env.example .env
```

### 3. Avvia API
```bash
cd api
yarn install
yarn build
yarn start
# Oppure in modalità dev:
# yarn dev
```

### 4. Avvia Worker
```bash
cd worker
yarn install
yarn build
yarn start
# Oppure in modalità dev:
# yarn dev
```

### 5. Avvia Frontend (dev mode)
```bash
cd web
yarn install
yarn dev
```

Frontend dev server: http://localhost:5173

## Variabili d'Ambiente

File `.env` nella root del progetto:

```bash
MONGO_URI=mongodb://mongo:27017/crawler
RABBIT_URL=amqp://rabbit:5672
PORT=8080
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_MOCK=0  # Imposta a 1 per usare mock invece di OpenAI
BASE_URL=http://api:8080
```

## Troubleshooting

### Errore: "Cannot connect to MongoDB"
```bash
# Verifica che MongoDB sia in esecuzione
docker compose ps

# Riavvia MongoDB
docker compose restart mongo
```

### Errore: "RabbitMQ connection failed"
```bash
# Verifica RabbitMQ
docker compose ps

# Riavvia RabbitMQ
docker compose restart rabbit
```

### Frontend non si carica
```bash
# Verifica che il build sia stato fatto
ls -la api/public/

# Se vuoto, rifai il build
yarn build-frontend
```

### Worker non processa i job
```bash
# Verifica i log del worker
docker compose logs worker

# Controlla la coda su RabbitMQ UI
# http://localhost:15672 → Queues → crawl.requests
```

### OpenAI API error
```bash
# Usa la modalità mock per testare senza OpenAI
# Modifica .env:
OPENAI_MOCK=1

# Riavvia il worker
docker compose restart worker
```

## API Endpoints

### POST /crawl
Invia un nuovo crawl:
```bash
curl -X POST http://localhost:8080/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Risposta:
```json
{"uid": "01JCS9..."}
```

### GET /crawl/:uid
Verifica lo stato:
```bash
curl http://localhost:8080/crawl/01JCS9...
```

Risposte possibili:
```json
// In elaborazione
{"status": "pending"}

// Completato
{
  "status": "done",
  "result": {
    "url": "https://example.com",
    "description": "Modern, clean layout...",
    "image": "data:image/jpeg;base64,...",
    "tookMs": 1234
  }
}

// Errore
{
  "status": "error",
  "message": "disallowed by robots.txt"
}
```

### GET /healthz
Health check:
```bash
curl http://localhost:8080/healthz
```

## Note Importanti

1. **Primo avvio**: Il primo build può richiedere 5-10 minuti per scaricare tutte le immagini Docker e dipendenze

2. **OpenAI API Key**: La chiave è già configurata in `.env`. Se vuoi usare la tua:
   ```bash
   # Modifica .env
   OPENAI_API_KEY=sk-proj-your-new-key
   
   # Riavvia il worker
   docker compose restart worker
   ```

3. **Rate Limiting**: L'API ha un limite di 10 richieste al minuto per IP. Per test intensivi, aumenta il limite in `api/src/routes/crawl.ts`

4. **Dimensione Screenshot**: Screenshot molto grandi (>16MB) falliranno. Questo è estremamente raro.

5. **Timeout**: Ogni crawl ha un timeout di 30 secondi. Pagine molto lente falliranno con timeout.

## Struttura dei Commit Git

Se hai usato `init-git.sh`, avrai questa struttura:

1. **feat: initial project structure and configuration**
2. **feat: implement Express API with MongoDB and RabbitMQ**
3. **feat: implement crawler worker with Playwright**
4. **feat: implement Vue 3 frontend with TypeScript**
5. **feat: add build scripts and E2E tests**
6. **docs: add comprehensive design documentation**

Visualizza:
```bash
git log --oneline --graph
```

## Documentazione Aggiuntiva

- `README.md` - Overview del progetto
- `PROJECT.md` - Note per i reviewer
- `design.md` - Decisioni architetturali dettagliate
- `api/src/` - Codice sorgente API con commenti
- `worker/src/` - Codice sorgente Worker con commenti
- `web/src/` - Codice sorgente Frontend con commenti

## Supporto

Questo progetto è stato sviluppato seguendo attentamente le specifiche fornite. Tutti i requisiti sono stati implementati e testati.

Per domande o chiarimenti, controlla:
1. I log: `docker compose logs -f`
2. RabbitMQ UI: http://localhost:15672
3. MongoDB: `docker compose exec mongo mongosh crawler`

---

**Buon testing!** 🚀
