# LaunchCheck — pilot per agenzie web

Controllo qualità di pagine pubbliche su desktop e mobile, con prove fotografiche, report condivisibili e confronto con una verifica precedente.

Questa release serve a erogare i primi controlli assistiti a pagamento. È un workspace **per una sola agenzia per installazione**: non contiene ancora account multi-tenant, abbonamenti, pagamenti o notifiche automatiche. Le valutazioni generative AI del vecchio crawler sono state rimosse dal percorso di audit: tutte le segnalazioni indicano un comportamento osservato o una variazione visiva da verificare.

## Cosa funziona

- Scansione fino a 10 URL dello stesso sito, scoperti dai link interni, su desktop 1440×900 e mobile 390×844.
- Errori HTTP della pagina, fino a 40 link interni verificati per audit, immagini non caricate, eccezioni JavaScript e contenuti che superano la larghezza del viewport.
- Screenshot del primo viewport di ogni pagina; differenze visive rispetto a una baseline (soglia: 1% dei pixel). Animazioni CSS disabilitate durante lo screenshot. Date, carousel e altri contenuti dinamici possono comunque generare differenze.
- Stati separati per scansione completa, parziale e fallita; robots.txt rispettato. Una pagina fallita non può far risultare risolti i problemi della baseline.
- Lista report e stati delle segnalazioni gestiti dall’agenzia. I problemi non più rilevati vengono riportati separatamente dalle segnalazioni marcate manualmente come risolte.
- Branding con nome agenzia e logo raster; report condiviso in sola lettura con link casuale revocabile; stampa/PDF dal browser, incluse le prove fotografiche.
- Persistenza MongoDB, coda RabbitMQ con conferma di pubblicazione, un worker alla volta e aggiornamenti di avanzamento. Una lease recupera le consegne rimaste in corso dopo il crash del worker.

## Avvio con Docker

Requisiti: Docker Engine con Compose, almeno 2 GB disponibili al worker e accesso Internet per scaricare le immagini. Le immagini si compilano dai sorgenti, senza build locali preliminari.

```sh
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Eseguire una seconda volta: usare valori differenti per ADMIN_TOKEN e RABBIT_PASSWORD.
# Inserire i due valori nel file .env, che non va versionato.
docker compose up --build -d
```

Aprire `http://localhost:8080` e inserire `ADMIN_TOKEN` nell’accesso agenzia. MongoDB e RabbitMQ non pubblicano porte verso l’host; l’applicazione è legata al loopback. Le immagini e i dati restano nei volumi Docker. Per un accesso remoto mettere davanti un reverse proxy HTTPS e un controllo di accesso; non esporre i database o il broker.

`ADMIN_TOKEN` è una credenziale amministrativa dell’intero workspace: distribuirla solo al personale dell’agenzia. Ruotarla nel file `.env` e ricreare il servizio API per revocare tutte le sessioni amministrative. Il browser la conserva soltanto in sessionStorage. I link condivisi usano un segreto differente, memorizzato come hash nel database; generarne uno nuovo invalida il precedente.

## Flusso per il primo cliente

1. Creare un report con URL, cliente, agenzia e numero massimo di pagine, confermando di essere autorizzati al controllo.
2. Verificare manualmente le segnalazioni e gli screenshot. Un contenuto fuori schermo può essere intenzionale; l’assenza di errori non è un’approvazione automatica del sito.
3. Segnare le segnalazioni risolte o ignorate e condividere il report. I destinatari non possono modificarlo.
4. Dopo le correzioni usare “Ripeti e confronta” per ottenere un secondo report con baseline. Per modifiche volute verificare il confronto visivo e usare la nuova scansione come baseline successiva.
5. Stampare il report dal browser scegliendo “Salva come PDF”. Il PDF non contiene i controlli amministrativi.

I report e gli screenshot possono contenere dati visibili sulle pagine del cliente. Il link condiviso consente l’accesso a chi lo possiede. Concordare con il cliente la conservazione, revocare i link al termine e gestire backup e cancellazione dei volumi secondo tale accordo. Questa release non applica una cancellazione automatica.

## Sviluppo e verifiche

Node.js 22 e npm. Un unico lockfile e workspace condiviso per tipi, modello dati e client HTTP sicuro.

```sh
npm ci
npm run build
npx playwright install chromium
npm test
```

`npm test` esegue test di API, isolamento dei link, URL/SSRF, confronto baseline, browser reale su siti fixture e interfaccia fino alla generazione di un PDF. I test browser richiedono un ambiente in grado di avviare Chromium. La CI esegue i test nell’immagine Playwright con browser e librerie di sistema già installati. Su Linux locale è possibile installare le librerie con `npx playwright install --with-deps chromium`.

Per i test di persistenza e coda aggiungere MongoDB/RabbitMQ e impostare:

```sh
INTEGRATION_TESTS=1 MONGO_URI=mongodb://localhost:27017/launchcheck_test RABBIT_URL=amqp://localhost:5672 npm test
```

Senza queste variabili il solo test di integrazione dei servizi viene esplicitamente saltato. Gli altri test usano siti fixture in memoria: non inviano richieste a siti di terzi. La CI verifica anche avvio reale dei due container, autenticazione API e audit delle dipendenze di produzione. Le prove browser sono negli artifact GitHub Actions.

Per il frontend in sviluppo: `npm run dev:web`; Vite inoltra `/api` al server locale sulla porta 8080. Il frontend si serve dall’API dopo `npm run build`.

## Confini del pilot

- Solo pagine pubbliche e GET/HEAD: nessun login, invio di moduli, checkout, validazione di cookie banner o verifica del corretto recapito di un contatto. Le risorse che richiedono cookie di sessione possono non essere riproducibili dal client isolato.
- Screenshot del viewport iniziale, non screenshot completi di tutta la pagina. Le misure di overflow riguardano gli elementi del DOM che risultano visibili secondo i controlli CSS eseguiti.
- Limiti per richiesta (tempo e byte), per pagina (risorse e byte), per audit (URL, link, segnalazioni) e per workspace. Budget esauriti producono una copertura parziale. Rate limit per IP, da configurare esplicitamente dietro un proxy affidabile.
- Il browser ha service worker, WebSocket e WebRTC disabilitati e un proxy senza uscita per il traffico non intercettato. Tutte le richieste di pagina passano attraverso un client HTTP che valida protocollo, porta, host e ogni risposta DNS e fissa l’IP della connessione; i redirect vengono rivalidati. Non disabilita la verifica TLS.
- Prima di un servizio pubblico non supervisionato aggiungere una barriera di egress a livello di rete per il worker, quote atomiche e conservazione automatica. Il pilot è riservato ad amministratori fidati e non è un servizio di scansione anonimo.
- Nessuna certificazione di sicurezza/accessibilità o promessa di incremento conversioni. Nessuna API AI a pagamento richiesta per i controlli attuali.

## Struttura

- `shared/`: tipi di report, schema MongoDB, confronto e client HTTP con protezione SSRF.
- `api/`: accesso agenzia, creazione e avanzamento report, gestione segnalazioni e condivisione.
- `worker/`: acquisizione Playwright, controlli deterministici, screenshot e differenze.
- `web/`: interfaccia Vue, report responsive e layout di stampa.
- `tests/`: fixture, test API/rete/browser/UI e integrazione dei servizi.

## Evoluzione commerciale successiva

Validare tre controlli assistiti pagati prima di aggiungere fatturazione, account per più agenzie o scansioni pianificate. Un abbonamento richiede poi isolamento tenant effettivo, ruoli, fatturazione, conservazione e gestione operativa. Il primo servizio può essere erogato manualmente con questa release dopo revisione e verifica delle segnalazioni.
