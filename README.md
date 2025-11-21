# Mini Crawler - API + Frontend + Worker

Un sistema di crawling distribuito che acquisisce screenshot di pagine web e li analizza usando OpenAI Vision per descrivere il design e l'UX.

## Architettura

- **API (Express)**: Gestisce richieste di crawl, serve il frontend statico
- **Worker (Node + Playwright)**: Consuma la coda, acquisisce screenshot, chiama OpenAI
- **Frontend (Vue 3 + TypeScript)**: Interfaccia utente per inviare URL e visualizzare risultati
- **MongoDB**: Persistenza dei dati
- **RabbitMQ**: Sistema di code per comunicazione asincrona

## Prerequisiti

- Docker e Docker Compose
- Node.js 20+ e Yarn (per sviluppo locale)
- OpenAI API Key

## Setup

1. **Copia il file di ambiente**:
   ```bash
   cp .env.example .env
   ```

2. **Configura la tua OpenAI API Key** in `.env`:
   ```
   OPENAI_API_KEY=sk-proj-your-key-here
   ```
   
   Oppure usa la modalità mock:
   ```
   OPENAI_MOCK=1
   ```

3. **Build del frontend**:
   ```bash
   yarn build-frontend
   ```

4. **Avvia lo stack completo**:
   ```bash
   docker compose up --build
   ```

## Utilizzo

- **Frontend**: http://localhost:8080
- **RabbitMQ Management UI**: http://localhost:15672 (guest/guest)
- **API Health**: http://localhost:8080/healthz

### API Endpoints

#### POST /crawl
Avvia un nuovo crawl:
```bash
curl -X POST http://localhost:8080/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Risposta:
```json
{
  "uid": "01J..."
}
```

#### GET /crawl/:uid
Verifica lo stato di un crawl:
```bash
curl http://localhost:8080/crawl/01J...
```

Risposte possibili:
- `{"status": "pending"}` - In elaborazione
- `{"status": "done", "result": {...}}` - Completato con successo
- `{"status": "error", "message": "..."}` - Errore

## Testing

Esegui i test end-to-end:
```bash
yarn test:e2e
```

Questo:
- Avvia lo stack Docker
- Testa 3 URL (incluso uno vietato da robots.txt)
- Verifica l'idempotenza delle richieste
- Valida gli esiti

## Sviluppo Locale

### API
```bash
cd api
yarn install
yarn dev
```

### Worker
```bash
cd worker
yarn install
yarn dev
```

### Frontend
```bash
cd web
yarn install
yarn dev
```

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| MONGO_URI | mongodb://mongo:27017/crawler | URI MongoDB |
| RABBIT_URL | amqp://rabbit:5672 | URL RabbitMQ |
| PORT | 8080 | Porta API |
| OPENAI_API_KEY | - | Chiave API OpenAI |
| OPENAI_MOCK | 0 | 1 per usare risposte mock |
| BASE_URL | http://api:8080 | Base URL per l'API |

## Note

- Il worker rispetta robots.txt e segna come errore URL vietati
- Timeout di 30 secondi per pagina
- Screenshot JPEG qualità 50 per ottimizzare dimensioni
- Idempotenza: stessa URL entro 5 minuti riusa lo stesso job
- Rate limiting: 10 richieste/minuto per IP
- Retry automatico: massimo 2 tentativi con dead-letter queue

## Struttura Repository

```
/app
  /api          - Express API + static server
  /web          - Vue 3 frontend
  /worker       - Playwright worker
  docker-compose.yml
  Dockerfile.api
  Dockerfile.worker
  .env.example
```
