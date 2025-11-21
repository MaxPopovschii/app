# Decisioni Progettuali

## Architettura

Il sistema è composto da:
- **API** (Express): endpoint REST e serve il frontend Vue(statico)
- **Worker** (Node + Playwright): processa i job di crawling
- **MongoDB**: salva i risultati
- **RabbitMQ**: gestisce la coda dei messaggi

## Scelte Tecniche

### Salvataggio Immagini
Ho salvato le immagini direttamente come Buffer nei documenti MongoDB, senza usare GridFS.

Perché?
- Più semplice: un'unica query per recuperare tutto
- Le immagini JPEG a qualità 50 pesano meno di 1MB
- Ampiamente sotto il limite di 16MB di MongoDB

### Idempotenza
Se invii lo stesso URL entro 5 minuti, ritorna lo stesso UID senza rifare il crawl.

Come funziona:
- Controllo se esiste già una richiesta pending per quell'URL
- L'URL viene normalizzato (lowercase, senza #fragment)
- Se esiste, riuso il job esistente

### Strategia di Retry
Massimo 2 tentativi, poi il messaggio va nella dead-letter queue.

Gestisce:
- Errori temporanei (network, crash browser)
- Errori persistenti vanno in DLQ
- robots.txt: marcato subito come errore, niente retry

### Timeout
Timeout massimo di 30 secondi per pagina.

```typescript
// Prima provo networkidle (10s)
await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

// Se fallisce, uso domcontentloaded
```

Alcune SPA non raggiungono mai networkidle, quindi ho il fallback.

### Robots.txt
Controllo robots.txt ma in modo "gentile": se c'è un errore (404, timeout), permetto il crawl comunque.

- Timeout: 20 secondi
- Se non risponde o è malformato → permetto
- httpbin.org/robots.txt impiega ~16 secondi a rispondere, quindi il timeout è importante

### OpenAI Vision
Uso GPT-4 Vision mandando l'immagine in base64.

Il prompt chiede di analizzare design e UX, evitando di leggere i contenuti testuali.
Limite di 500 token per contenere i costi.

C'è anche una modalità mock (`OPENAI_MOCK=1`) per testare senza chiamare l'API.

### Rate Limiting
10 richieste al minuto per IP (solo su POST /crawl).

Evita abusi ma permette di testare comodamente più URL.

### Polling Frontend
Il frontend fa polling con backoff esponenziale: parte da 2 secondi e arriva fino a 30 secondi.

Vantaggi:
- Risposta veloce per crawl rapidi
- Non sovraccarica il server per quelli lenti
- Mostra il tempo trascorso all'utente

## Indici MongoDB

```javascript
{ uid: 1 }              // Lookup per UID
{ url: 1, status: 1 }   // Controllo idempotenza
{ createdAt: -1 }       // Query temporali
```

## Gestione Errori

| Problema | Come lo gestisco |
|---------|----------|
| Worker in crash | RabbitMQ rimanda il messaggio |
| Browser va in timeout | Retry fino a 2 volte |
| OpenAI down | Retry fino a 2 volte |
| DB/RabbitMQ down | API ritorna 503 |
