# Mini Crawler - Local Development (No Docker)

Poiché non hai Docker installato, ecco come puoi testare il progetto localmente:

## Opzioni

### Opzione 1: Installa Docker (Consigliato)
```bash
# Installa Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Riavvia o fai logout/login

# Poi:
docker compose up --build
```

### Opzione 2: Usa servizi cloud gratuiti

Modifica `.env`:
```bash
# Usa MongoDB Atlas (gratuito)
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/crawler

# Usa CloudAMQP (gratuito)
RABBIT_URL=amqps://user:pass@server.cloudamqp.com/vhost

# Resto uguale
PORT=8080
OPENAI_API_KEY=sk-proj-...
OPENAI_MOCK=1
```

### Opzione 3: Modalità Mock per Demo

Ho creato una versione semplificata che non richiede MongoDB/RabbitMQ.

## Setup Rapido Locale

1. **Installa le dipendenze**:
```bash
cd /home/vincent/test-project/app

# API
cd api
yarn install
yarn build

# Worker  
cd ../worker
yarn install
yarn build

# Già fatto
cd ../web
```

2. **Avvia in modalità sviluppo**:

```bash
# Terminal 1 - API
cd api
yarn dev

# Terminal 2 - Worker (opzionale)
cd worker
yarn dev

# Terminal 3 - Frontend
cd web
yarn dev
```

3. **Accedi a**: http://localhost:5173

## Note

- Il frontend dev (Vite) gira su porta 5173
- L'API dovrebbe girare su porta 8080
- Senza MongoDB/RabbitMQ il progetto non funzionerà completamente
- Per una demo completa, **Docker è necessario**

## Installa Docker (Più Semplice)

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Verifica
docker --version
docker compose version

# Avvia il progetto
cd /home/vincent/test-project/app
docker compose up --build
```

Docker è l'opzione consigliata perché:
- ✅ Setup automatico di MongoDB e RabbitMQ
- ✅ Ambiente isolato
- ✅ Funziona esattamente come in produzione
- ✅ Un solo comando per avviare tutto
