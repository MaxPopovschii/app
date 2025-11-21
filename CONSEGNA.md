# Mini Crawler - Note di Consegna

## Cosa ho implementato

### File principali
- **README.md** - Setup e utilizzo del progetto
- **design.md** - Decisioni tecniche e architetturali
- **.env.example** - Variabili di configurazione

### Architettura
Il progetto è diviso in 3 componenti principali:

**API** (Express + TypeScript)
- Endpoint REST per avviare e monitorare i crawl
- Serve il frontend Vue compilato
- Gestisce idempotenza (stesso URL entro 5 min = stesso job)
- Rate limiting 10 richieste/minuto

**Worker** (Node + Playwright)
- Consuma messaggi da RabbitMQ
- Usa Playwright per aprire le pagine e fare screenshot
- Chiama OpenAI Vision per analizzare il design
- Rispetta robots.txt con timeout di 20 secondi
- Retry automatico fino a 2 volte se fallisce

**Frontend** (Vue 3)
- Form per inserire l'URL
- Polling automatico per controllare lo stato
- Mostra screenshot e descrizione AI quando pronto

### Test
Script `yarn test:e2e` che testa:
- 3 URL diversi (incluso uno bloccato da robots.txt)
- Idempotenza delle richieste
- Tutti i test passano

## Come testare

```bash
# Compilare il frontend
yarn build-frontend

# Avviare tutto
docker compose up --build -d

# Aspettare che i servizi siano pronti
sleep 15

# Eseguire i test
yarn test:e2e
```

Dovresti vedere "All tests passed!" alla fine.

Puoi anche testare manualmente aprendo http://localhost:8080

## Note importanti

1. Serve una chiave OpenAI nel file `.env`, oppure usa `OPENAI_MOCK=1` per testare senza
2. RabbitMQ UI disponibile su http://localhost:15672 (guest/guest)
3. I commit git sono 8 invece di 3-6, ma sono organizzati in modo logico

## Struttura progetto

```
/app
├── README.md
├── design.md
├── docker-compose.yml
├── /api          - Backend Express
├── /worker       - Crawler Playwright
├── /web          - Frontend Vue
└── /scripts      - Test E2E
```

## Cosa consegnare

Il repository GitHub: https://github.com/MaxPopovschii/app

