<template>
  <div class="shell" :class="{ 'public-report': isPublic }">
    <aside v-if="!isPublic" class="sidebar no-print">
      <a class="brand" href="/" aria-label="LaunchCheck home"
        ><span class="brand-mark">↗</span> LaunchCheck<span class="pilot"
          >PILOT</span
        ></a
      >
      <div class="workspace">
        <span class="avatar">{{ agencyInitial }}</span>
        <div>
          <strong>{{ agency || "Il tuo studio" }}</strong
          ><small>Workspace agenzia</small>
        </div>
      </div>
      <div class="nav-label">IL TUO LAVORO</div>
      <button class="nav-item active" @click="goHome">
        ▦ <span>Report dei clienti</span
        ><span class="counter">{{ reports.length }}</span>
      </button>
      <button
        class="nav-item"
        @click="openForm = true"
        :disabled="!canEdit || !ready"
      >
        ＋ <span>Nuova verifica</span>
      </button>
      <button v-if="connected" class="nav-item" @click="openAccount = true">
        ◎ <span>Il mio account</span>
      </button>
      <div class="sidebar-footer">
        <span class="status-dot"></span> Verifiche con prove, non
        supposizioni.<button v-if="connected" class="logout" @click="logout">
          Esci dal workspace
        </button>
      </div>
    </aside>
    <main>
      <header class="topbar no-print">
        <span>{{
          isPublic
            ? "Report condiviso dall’agenzia"
            : "Workspace / Report dei clienti"
        }}</span
        ><span class="top-tag">{{
          isPublic ? "Sola lettura" : "Release pilota · 0.1"
        }}</span>
      </header>
      <div class="content">
        <div v-if="error" role="alert" class="notice error">
          {{ error
          }}<button aria-label="Chiudi errore" @click="error = ''">×</button>
        </div>
        <div v-if="toast" role="status" class="notice">{{ toast }}</div>
        <div
          v-if="connected && !ready"
          role="status"
          class="notice warning no-print"
        >
          Nuove verifiche temporaneamente sospese. I report esistenti restano
          consultabili.
        </div>
        <section v-if="!isPublic && !connected" class="login-panel">
          <div class="eyebrow">DAL CONTROLLO ALLA CONSEGNA</div>
          <h1>Consegna siti.<br /><em>Non sorprese.</em></h1>
          <p>
            Controlla desktop e mobile. Raccogli prove concrete e condividi con
            il cliente un report che racconta il tuo lavoro.
          </p>
          <form @submit.prevent="connect">
            <label for="email">Email</label
            ><input
              id="email"
              v-model="emailInput"
              type="email"
              autocomplete="username"
              required
              maxlength="254"
              placeholder="nome@agenzia.it"
            />
            <label for="password">Password</label
            ><input
              id="password"
              v-model="passwordInput"
              type="password"
              autocomplete="current-password"
              required
              maxlength="128"
            /><button class="primary" :disabled="busy">
              {{ busy ? "Connessione…" : "Entra nel workspace →" }}
            </button>
          </form>
          <small
            >Accedi con il tuo account personale. I link dei report hanno un
            accesso separato, scadono e possono essere revocati.</small
          >
        </section>
        <template v-else-if="!report && !isPublic">
          <div class="page-heading">
            <div>
              <div class="eyebrow">CONTROLLO QUALITÀ, CONDIVISO</div>
              <h1>Ogni consegna, sotto controllo.</h1>
              <p>
                I report dei tuoi clienti, le prove e il prossimo intervento.
              </p>
            </div>
            <button
              v-if="canEdit"
              class="primary"
              @click="openForm = true"
              :disabled="!ready"
            >
              ＋ Nuova verifica
            </button>
          </div>
          <div class="stats">
            <article>
              <small>REPORT CREATI</small
              ><strong>{{ reports.length.toString().padStart(2, "0") }}</strong
              ><span>Il lavoro del tuo studio</span>
            </article>
            <article>
              <small>VERIFICHE IN CORSO</small
              ><strong>{{ runningCount.toString().padStart(2, "0") }}</strong
              ><span>Desktop e mobile</span>
            </article>
            <article>
              <small>PROBLEMI AD ALTA PRIORITÀ</small
              ><strong>{{ highCount.toString().padStart(2, "0") }}</strong
              ><span>Nei report più recenti</span>
            </article>
          </div>
          <section class="report-list">
            <div class="section-heading">
              <h2>
                Report recenti <span>{{ reports.length }}</span>
              </h2>
              <button class="text-button" @click="loadReports">
                Aggiorna ↻
              </button>
            </div>
            <div v-if="!reports.length" class="empty">
              <div class="empty-icon">▤</div>
              <h2>La prima consegna parte da qui.</h2>
              <p>
                Inserisci il sito di un cliente. Analizziamo fino a 10 pagine
                pubbliche in due formati e raccogliamo le prove in un unico
                report.
              </p>
              <button
                v-if="canEdit"
                class="primary"
                @click="openForm = true"
                :disabled="!ready"
              >
                Crea il primo report →
              </button>
            </div>
            <button
              v-for="item in reports"
              :key="item.id"
              class="report-row"
              @click="selectReport(item.id)"
            >
              <div class="site-icon">
                {{ item.client.slice(0, 1).toUpperCase() }}
              </div>
              <div class="row-title">
                <strong>{{ item.client }}</strong
                ><span>{{ displayHost(item.url) }}</span>
              </div>
              <span class="badge" :class="item.status">{{
                statusLabel(item.status)
              }}</span>
              <div class="row-count">
                <strong>{{ item.findingCount }}</strong
                ><small>segnalazioni</small>
              </div>
              <span class="date">{{ formatDate(item.createdAt) }}</span
              ><span class="row-arrow">↗</span>
            </button>
          </section>
          <div class="scope-note">
            <strong>Un report utile, con limiti chiari.</strong>
            <p>
              Verifichiamo pagine pubbliche, immagini, link interni, eccezioni
              JavaScript e contenuti fuori schermo. Login, acquisti e invio dei
              moduli richiedono verifiche dedicate.
            </p>
          </div>
        </template>
        <section v-else-if="report" class="report-detail">
          <div class="report-actions no-print">
            <button v-if="!isPublic" class="text-button" @click="goHome">
              ← Tutti i report
            </button>
            <div class="actions-right">
              <button
                v-if="!isPublic && canEdit && finished"
                @click="repeatReport"
                class="secondary"
              >
                Ripeti e confronta</button
              ><button
                v-if="!isPublic && canEdit"
                @click="shareReport"
                class="secondary"
              >
                Crea nuovo link ↗</button
              ><button
                v-if="!isPublic && canEdit"
                @click="revokeShare"
                class="text-button"
              >
                Revoca link</button
              ><button
                v-if="!isPublic && canEdit && finished"
                @click="deleteConfirm = true"
                class="text-button danger"
              >
                Elimina report</button
              ><button v-if="finished" @click="printReport" class="primary">
                Stampa / PDF
              </button>
            </div>
          </div>
          <div v-if="shareUrl" class="notice no-print">
            Link pronto:
            <a :href="shareUrl" target="_blank" rel="noopener"
              >Apri report condiviso ↗</a
            ><small
              >Chi possiede questo link può vedere il report e le immagini. Un
              nuovo link revoca il precedente.</small
            >
          </div>
          <header class="report-cover">
            <div>
              <div class="eyebrow">REPORT DI CONTROLLO QUALITÀ</div>
              <h1>{{ report.client }}</h1>
              <p>{{ report.url }}</p>
              <div class="cover-meta">
                <span class="badge" :class="report.status">{{
                  statusLabel(report.status)
                }}</span
                ><span>{{ formatDate(report.createdAt) }}</span
                ><span>Desktop 1440 px · Mobile 390 px</span>
              </div>
            </div>
            <div class="agency-signature">
              <img
                v-if="report.logo"
                :src="report.logo"
                alt="Logo agenzia"
              /><strong>{{ report.agency }}</strong
              ><small>Preparato con LaunchCheck</small>
            </div>
          </header>
          <div v-if="!finished" class="progress-panel" role="status">
            <div class="pulse"></div>
            <div>
              <strong>{{
                report.status === "queued"
                  ? "In attesa del prossimo slot"
                  : "Stiamo raccogliendo le prove"
              }}</strong>
              <p>
                {{ report.scannedPages }} viste completate{{
                  report.totalPages ? " su " + report.totalPages : ""
                }}. Puoi lasciare questa pagina e tornare più tardi.
              </p>
            </div>
          </div>
          <div
            v-if="report.status === 'failed' || report.status === 'partial'"
            class="notice warning"
          >
            {{
              report.status === "failed"
                ? "Verifica non completata."
                : "Copertura parziale."
            }}
            Consulta le pagine non acquisite: l’assenza di segnalazioni su
            quelle pagine non indica che siano prive di problemi.
            {{ report.error || "" }}
          </div>
          <div class="stats report-stats">
            <article>
              <small>SEGNALAZIONI APERTE</small
              ><strong>{{
                openFindings.length.toString().padStart(2, "0")
              }}</strong
              ><span>{{ highOpen }} ad alta priorità</span>
            </article>
            <article>
              <small>VISTE ACQUISITE</small
              ><strong>{{
                report.pages
                  .filter((p) => p.status === "done")
                  .length.toString()
                  .padStart(2, "0")
              }}</strong
              ><span
                >{{ new Set(report.pages.map((p) => p.url)).size }} pagine · 2
                formati</span
              >
            </article>
            <article>
              <small>NON PIÙ RILEVATE</small
              ><strong>{{
                report.resolvedSinceBaseline.length.toString().padStart(2, "0")
              }}</strong
              ><span>{{
                report.baselineId
                  ? "Rispetto alla baseline"
                  : "Confronto con una verifica precedente"
              }}</span>
            </article>
          </div>
          <div class="report-columns">
            <section class="findings">
              <div class="section-heading">
                <h2>
                  Le cose da verificare
                  <span>{{ report.findings.length }}</span>
                </h2>
                <select
                  v-model="filter"
                  aria-label="Filtra segnalazioni"
                  class="no-print"
                >
                  <option value="all">Tutte le segnalazioni</option>
                  <option value="open">Solo aperte</option>
                  <option value="high">Alta priorità</option>
                  <option value="visual">Variazioni visive</option>
                </select>
              </div>
              <div v-if="!filteredFindings.length" class="empty compact">
                <div class="empty-icon">✓</div>
                <h3>
                  {{
                    report.findings.length
                      ? "Nessun risultato per questo filtro."
                      : finished
                        ? "Nessun problema rilevato dai controlli eseguiti."
                        : "Le segnalazioni compariranno qui."
                  }}
                </h3>
                <p>
                  La verifica automatica copre solo i controlli e le pagine
                  elencati nel report.
                </p>
              </div>
              <article
                v-for="finding in filteredFindings"
                :key="finding.id"
                class="finding-card"
                :class="{ selected: selectedFinding?.id === finding.id }"
              >
                <div class="finding-top">
                  <span class="severity" :class="finding.severity">{{
                    severityLabel(finding.severity)
                  }}</span
                  ><span class="source">{{
                    finding.source === "visual-comparison"
                      ? "CONFRONTO VISIVO · DA VERIFICARE"
                      : "CONTROLLO AUTOMATICO"
                  }}</span
                  ><span v-if="report.baselineId" class="change-tag">{{
                    finding.change === "new" ? "Nuova" : "Già presente"
                  }}</span>
                </div>
                <button class="finding-title" @click="showEvidence(finding)">
                  {{ finding.title }} <span>↗</span>
                </button>
                <div class="finding-location">
                  {{ finding.viewport === "mobile" ? "▯ Mobile" : "▰ Desktop" }}
                  · {{ displayPath(finding.url) }}
                </div>
                <p>{{ finding.detail }}</p>
                <code v-if="finding.selector">{{ finding.selector }}</code>
                <div class="recommendation">
                  <strong>PROSSIMO PASSO</strong>
                  <p>{{ finding.recommendation }}</p>
                </div>
                <footer>
                  <button class="text-button" @click="showEvidence(finding)">
                    Vedi prova →</button
                  ><select
                    v-if="!isPublic && canEdit && finished"
                    :value="finding.status"
                    @change="
                      updateFinding(
                        finding,
                        ($event.target as HTMLSelectElement).value,
                      )
                    "
                    :aria-label="'Stato: ' + finding.title"
                  >
                    <option value="open">Da verificare</option>
                    <option value="resolved">Risolta dall’agenzia</option>
                    <option value="ignored">Ignorata</option></select
                  ><span v-else class="finding-state">{{
                    finding.status === "resolved"
                      ? "Risolta dall’agenzia"
                      : finding.status === "ignored"
                        ? "Ignorata"
                        : "Da verificare"
                  }}</span>
                </footer>
              </article>
            </section>
            <aside class="evidence-panel">
              <div class="section-heading"><h2>Prove e copertura</h2></div>
              <template v-if="selectedPage"
                ><div class="evidence-caption">
                  <strong>{{
                    selectedPage.viewport === "mobile"
                      ? "Vista mobile · 390 px"
                      : "Vista desktop · 1440 px"
                  }}</strong
                  ><span>{{ displayPath(selectedPage.url) }}</span>
                </div>
                <EvidenceImage
                  v-if="selectedPage.screenshot"
                  :url="assetUrl(selectedPage.screenshot)"
                  alt="Screenshot della pagina verificata" /><template
                  v-if="selectedPage.diffScreenshot"
                  ><h3 class="diff-heading">Differenze dalla baseline</h3>
                  <EvidenceImage
                    :url="assetUrl(selectedPage.diffScreenshot)"
                    alt="Differenze visive evidenziate rispetto alla baseline" /></template
              ></template>
              <p v-else class="muted">
                Le acquisizioni saranno disponibili qui.
              </p>
              <div class="page-coverage">
                <button
                  v-for="(page, index) in report.pages"
                  :key="index"
                  @click="selectedPage = page"
                  :class="{ chosen: selectedPage === page }"
                >
                  <span>{{ page.status === "done" ? "✓" : "!" }}</span>
                  <div>
                    <strong>{{ displayPath(page.url) }}</strong
                    ><small
                      >{{ page.viewport
                      }}{{ page.error ? " · " + page.error : "" }}</small
                    >
                  </div>
                </button>
              </div>
            </aside>
          </div>
          <section
            v-if="report.resolvedSinceBaseline.length"
            class="resolved-list"
          >
            <h2>Non più rilevate rispetto alla baseline</h2>
            <p>
              Confronto limitato alle pagine acquisite con successo in questa
              verifica.
            </p>
            <div
              v-for="finding in report.resolvedSinceBaseline"
              :key="finding.id"
            >
              ✓ {{ finding.title }} · {{ finding.viewport }} ·
              {{ displayPath(finding.url) }}
            </div>
          </section>
          <section class="print-only">
            <h2>Prove fotografiche</h2>
            <article
              v-for="page in report.pages.filter((p) => p.screenshot)"
              :key="page.url + page.viewport"
            >
              <h3>{{ page.viewport }} · {{ page.url }}</h3>
              <EvidenceImage
                :url="assetUrl(page.screenshot!)"
                alt="Screenshot della pagina verificata"
              />
            </article>
          </section>
          <section class="methodology">
            <p v-if="report.retentionUntil">
              Conservazione del report fino al
              {{ formatDate(report.retentionUntil) }}.
              <span v-if="report.shareExpiresAt"
                >Link condiviso valido fino al
                {{ formatDate(report.shareExpiresAt) }}.</span
              >
            </p>
            <h2>Come leggere questo report</h2>
            <p>
              Le segnalazioni automatiche descrivono comportamenti osservati,
              non il loro impatto commerciale. Le variazioni visive possono
              essere intenzionali. Lo stato “risolta” è una decisione
              dell’agenzia; una nuova verifica serve a confermarla.
            </p>
            <ul>
              <li v-for="note in report.notes" :key="note">{{ note }}</li>
            </ul>
            <p class="report-id">
              Report {{ report.id }} · {{ report.pages.length }} viste tentate ·
              Nessuna certificazione di accessibilità o sicurezza.
            </p>
          </section>
        </section>
        <section v-else class="empty">
          <h1>
            {{ error ? "Report non disponibile" : "Caricamento report…" }}
          </h1>
        </section>
      </div>
    </main>
    <div
      v-if="openForm && canEdit && !isPublic"
      class="modal-backdrop no-print"
      @click.self="openForm = false"
    >
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-report-title"
      >
        <button
          class="modal-close"
          @click="openForm = false"
          aria-label="Chiudi"
        >
          ×
        </button>
        <div class="eyebrow">UNA NUOVA CONSEGNA</div>
        <h2 id="new-report-title">Prima le prove.<br />Poi il via libera.</h2>
        <p>Una verifica delle pagine pubbliche, su desktop e mobile.</p>
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <form @submit.prevent="createReport">
          <label for="target">Sito del cliente</label
          ><input
            id="target"
            v-model="target"
            type="url"
            placeholder="https://cliente.it"
            required
          />
          <div class="form-grid">
            <div>
              <label for="client">Nome cliente</label
              ><input
                id="client"
                v-model="client"
                maxlength="100"
                required
                placeholder="Studio Aurora"
              />
            </div>
            <div>
              <label for="agency">La tua agenzia</label
              ><input
                id="agency"
                v-model="agency"
                readonly
                maxlength="100"
                required
                placeholder="Il tuo studio"
              />
            </div>
          </div>
          <div class="form-grid">
            <div>
              <label for="max-pages">Pagine da verificare</label
              ><select id="max-pages" v-model.number="maxPages">
                <option :value="1">1 pagina · 2 viste</option>
                <option :value="5">Fino a 5 pagine · 10 viste</option>
                <option :value="10">Fino a 10 pagine · 20 viste</option>
              </select>
            </div>
            <div>
              <label for="logo">Logo nel report</label
              ><input
                id="logo"
                type="file"
                accept="image/png,image/jpeg"
                @change="loadLogo"
              /><small>PNG/JPEG · massimo 200 KB</small>
            </div>
          </div>
          <label for="baseline">Confronta con una baseline</label
          ><select id="baseline" v-model="baselineId">
            <option value="">Nessun confronto</option>
            <option v-for="item in baselines" :key="item.id" :value="item.id">
              {{ item.client }} · {{ formatDate(item.createdAt) }}
            </option></select
          ><label class="checkbox"
            ><input v-model="authorized" type="checkbox" required /><span
              >Confermo di essere autorizzato a verificare questo sito e a
              raccogliere gli screenshot delle pagine pubbliche.</span
            ></label
          ><button class="primary full-width" :disabled="busy">
            {{ busy ? "Creazione…" : "Avvia la verifica →" }}</button
          ><small class="form-footnote"
            >Massimo 10 pagine dello stesso sito. Nessun invio di moduli o
            acquisto.</small
          >
        </form>
      </section>
    </div>
    <div
      v-if="openAccount"
      class="modal-backdrop no-print"
      @click.self="openAccount = false"
    >
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <button
          class="modal-close"
          @click="openAccount = false"
          aria-label="Chiudi account"
        >
          ×
        </button>
        <h2 id="account-title">Il mio account</h2>
        <p>{{ user?.name }} · {{ user?.email }} · {{ user?.role }}</p>
        <p>
          La tua agenzia: {{ agency }}. Conservazione report:
          {{ user?.agency.retentionDays }} giorni. Link condivisi:
          {{ user?.agency.shareDays }} giorni.
        </p>
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <form @submit.prevent="changePassword">
          <label for="current-password">Password attuale</label
          ><input
            id="current-password"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
          /><label for="new-password">Nuova password</label
          ><input
            id="new-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="15"
            maxlength="128"
            required
          />
          <p>
            Da 15 a 128 caratteri. Il cambio revoca tutte le sessioni
            dell’account.
          </p>
          <button class="primary" :disabled="busy">
            Aggiorna password e disconnetti
          </button>
        </form>
      </section>
    </div>
    <div
      v-if="deleteConfirm && report"
      class="modal-backdrop no-print"
      @click.self="deleteConfirm = false"
    >
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">Eliminare il report di {{ report.client }}?</h2>
        <p>
          Il report e i link condivisi diventano subito inaccessibili. Il worker
          rimuove dati e screenshot nel successivo ciclo di pulizia. Eventuali
          copie nei backup seguono la conservazione dei backup.
        </p>
        <button class="secondary" @click="deleteConfirm = false">
          Annulla
        </button>
        <button class="primary" @click="deleteReport" :disabled="busy">
          Elimina definitivamente
        </button>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import type { AuditReport, Finding, PageResult } from "@launchcheck/shared";
import EvidenceImage from "./EvidenceImage.vue";
type Summary = Omit<
  AuditReport,
  "pages" | "findings" | "resolvedSinceBaseline"
> & { findingCount: number; highCount: number };
const sharedToken = window.location.pathname.match(
  /^\/report\/([A-Za-z0-9_-]{43})$/,
)?.[1];
const isPublic = window.location.pathname.startsWith("/report/");
interface Account {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member" | "viewer";
  agency: {
    id: string;
    name: string;
    retentionDays: number;
    shareDays: number;
    dailyLimit: number;
    concurrencyLimit: number;
  };
}
const user = ref<Account | null>(null),
  csrfToken = ref(""),
  ready = ref(true),
  openAccount = ref(false),
  deleteConfirm = ref(false),
  currentPassword = ref(""),
  newPassword = ref("");
const canEdit = computed(
  () => connected.value && user.value?.role !== "viewer",
);
const connected = ref(false),
  emailInput = ref(""),
  passwordInput = ref(""),
  busy = ref(false),
  error = ref(""),
  toast = ref("");
const reports = ref<Summary[]>([]),
  report = ref<AuditReport | null>(null),
  openForm = ref(false),
  selectedPage = ref<PageResult | null>(null),
  selectedFinding = ref<Finding | null>(null),
  filter = ref("all"),
  shareUrl = ref("");
const target = ref(""),
  client = ref(""),
  agency = ref(localStorage.getItem("launchcheck-agency") || ""),
  logo = ref<string | undefined>(),
  maxPages = ref(5),
  baselineId = ref(""),
  authorized = ref(false);
let timer: ReturnType<typeof setInterval> | undefined,
  polling = false;
const controller = new AbortController();
const agencyInitial = computed(() =>
  (agency.value || "L").slice(0, 1).toUpperCase(),
);
const runningCount = computed(
  () =>
    reports.value.filter((r) => ["queued", "running"].includes(r.status))
      .length,
);
const highCount = computed(() =>
  reports.value.reduce((sum, r) => sum + r.highCount, 0),
);
const finished = computed(() =>
  Boolean(
    report.value &&
      ["complete", "partial", "failed"].includes(report.value.status),
  ),
);
const openFindings = computed(
  () => report.value?.findings.filter((f) => f.status === "open") || [],
);
const highOpen = computed(
  () => openFindings.value.filter((f) => f.severity === "high").length,
);
const filteredFindings = computed(() =>
  (report.value?.findings || []).filter(
    (f) =>
      filter.value === "all" ||
      (filter.value === "open" && f.status === "open") ||
      (filter.value === "high" && f.severity === "high") ||
      (filter.value === "visual" && f.source === "visual-comparison"),
  ),
);
const baselines = computed(() =>
  reports.value.filter(
    (r) =>
      ["complete", "partial"].includes(r.status) &&
      (() => {
        try {
          return new URL(r.url).origin === new URL(target.value).origin;
        } catch {
          return false;
        }
      })(),
  ),
);
function statusLabel(status: string) {
  return (
    (
      {
        queued: "In coda",
        running: "In corso",
        complete: "Completata",
        partial: "Parziale",
        failed: "Non completata",
      } as Record<string, string>
    )[status] || status
  );
}
function severityLabel(severity: string) {
  return (
    {
      high: "Alta priorità",
      medium: "Da verificare",
      low: "Osservazione",
    } as Record<string, string>
  )[severity];
}
function displayHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function displayPath(url: string) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}
function formatDate(date: string) {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken.value ? { "X-CSRF-Token": csrfToken.value } : {}),
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error || "Richiesta non riuscita");
  return data;
}
async function loadReports() {
  try {
    reports.value = await api("/api/reports");
  } catch (err: any) {
    error.value = err.message;
    throw err;
  }
}
async function connect() {
  busy.value = true;
  error.value = "";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: emailInput.value,
        password: passwordInput.value,
      }),
    });
    user.value = data.user;
    csrfToken.value = data.csrfToken;
    agency.value = data.user.agency.name;
    connected.value = true;
    await loadReports();
    await checkReady();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    passwordInput.value = "";
    busy.value = false;
  }
}
async function logout() {
  try {
    if (connected.value) await api("/api/auth/logout", { method: "POST" });
  } catch {}
  user.value = null;
  csrfToken.value = "";
  connected.value = false;
  report.value = null;
  reports.value = [];
  openAccount.value = false;
  history.replaceState(null, "", "/");
}
async function checkReady() {
  try {
    const response = await fetch("/readyz", { signal: controller.signal });
    ready.value = response.ok;
  } catch {
    ready.value = false;
  }
}
async function changePassword() {
  busy.value = true;
  error.value = "";
  try {
    await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    });
    await logout();
    toast.value = "Password aggiornata. Accedi di nuovo.";
  } catch (err: any) {
    error.value = err.message;
  } finally {
    currentPassword.value = "";
    newPassword.value = "";
    busy.value = false;
  }
}
async function deleteReport() {
  if (!report.value) return;
  busy.value = true;
  try {
    await api("/api/reports/" + report.value.id, { method: "DELETE" });
    deleteConfirm.value = false;
    goHome();
    toast.value = "Report eliminato. Link revocati; pulizia dei file in corso.";
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
async function selectReport(id: string) {
  error.value = "";
  shareUrl.value = "";
  try {
    report.value = await api("/api/reports/" + id);
    selectedFinding.value = null;
    selectedPage.value = report.value?.pages.find((p) => p.screenshot) || null;
    history.replaceState(null, "", "?report=" + id);
  } catch (err: any) {
    error.value = err.message;
  }
}
function goHome() {
  report.value = null;
  selectedPage.value = null;
  shareUrl.value = "";
  toast.value = "";
  error.value = "";
  history.replaceState(null, "", "/");
  if (connected.value) loadReports().catch(() => {});
}
async function createReport() {
  busy.value = true;
  error.value = "";
  try {
    const data = await api("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        url: target.value,
        agency: agency.value,
        client: client.value,
        maxPages: maxPages.value,
        baselineId: baselineId.value || undefined,
        logo: logo.value,
        authorized: authorized.value,
      }),
    });
    localStorage.setItem("launchcheck-agency", agency.value);
    openForm.value = false;
    await selectReport(data.id);
    shareUrl.value = new URL(data.sharePath, location.origin).href;
    await loadReports();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
function repeatReport() {
  if (!report.value) return;
  target.value = report.value.url;
  client.value = report.value.client;
  agency.value = report.value.agency;
  logo.value = report.value.logo;
  baselineId.value = report.value.id;
  maxPages.value = report.value.maxPages;
  authorized.value = false;
  openForm.value = true;
}
async function shareReport() {
  if (!report.value) return;
  try {
    const data = await api("/api/reports/" + report.value.id + "/share", {
      method: "POST",
    });
    shareUrl.value = new URL(data.sharePath, location.origin).href;
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      toast.value = "Nuovo link copiato. Il precedente non è più valido.";
    } catch {
      toast.value =
        "Link creato: puoi aprirlo e copiarlo dal riquadro qui sotto.";
    }
  } catch (err: any) {
    error.value = err.message;
  }
}
async function revokeShare() {
  if (!report.value) return;
  try {
    await api("/api/reports/" + report.value.id + "/share", {
      method: "DELETE",
    });
    shareUrl.value = "";
    toast.value = "I link condivisi precedenti sono stati revocati.";
  } catch (err: any) {
    error.value = err.message;
  }
}
function showEvidence(finding: Finding) {
  selectedFinding.value = finding;
  selectedPage.value =
    report.value?.pages.find(
      (p) => p.url === finding.url && p.viewport === finding.viewport,
    ) || null;
}
async function updateFinding(finding: Finding, status: string) {
  if (!report.value) return;
  try {
    report.value = await api(
      `/api/reports/${report.value.id}/findings/${finding.id}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
  } catch (err: any) {
    error.value = err.message;
  }
}
function assetUrl(file: string) {
  return isPublic
    ? `/api/share/${sharedToken}/assets/${file}`
    : `/api/reports/${report.value!.id}/assets/${file}`;
}
function printReport() {
  window.print();
}
async function loadLogo(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) {
    logo.value = undefined;
    return;
  }
  if (file.size > 200_000 || !["image/png", "image/jpeg"].includes(file.type)) {
    error.value = "Scegli un logo PNG/JPEG inferiore a 200 KB";
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    logo.value = String(reader.result);
  };
  reader.readAsDataURL(file);
}
let previousFocus: HTMLElement | null = null;
watch(openForm, async (open) => {
  if (open) {
    previousFocus = document.activeElement as HTMLElement;
    authorized.value = false;
    await nextTick();
    document.getElementById("target")?.focus();
  } else previousFocus?.focus();
});
function handleKeyboard(event: KeyboardEvent) {
  if (!openForm.value && !openAccount.value && !deleteConfirm.value) return;
  if (event.key === "Escape") {
    openForm.value = false;
    openAccount.value = false;
    deleteConfirm.value = false;
    return;
  }
  if (event.key !== "Tab") return;
  const fields = [
    ...document.querySelectorAll<HTMLElement>(
      ".modal button:not([disabled]), .modal input:not([disabled]), .modal select:not([disabled])",
    ),
  ];
  const first = fields[0],
    last = fields[fields.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    last?.focus();
    event.preventDefault();
  } else if (!event.shiftKey && document.activeElement === last) {
    first?.focus();
    event.preventDefault();
  }
}
onMounted(async () => {
  document.addEventListener("keydown", handleKeyboard);
  try {
    if (isPublic) {
      report.value = await api("/api/share/" + sharedToken);
      selectedPage.value =
        report.value?.pages.find((p) => p.screenshot) || null;
    } else {
      sessionStorage.removeItem("launchcheck-token");
      const response = await fetch("/api/auth/session", {
        signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json();
        user.value = data.user;
        csrfToken.value = data.csrfToken;
        agency.value = data.user.agency.name;
        connected.value = true;
        await loadReports();
        await checkReady();
        const id = new URLSearchParams(location.search).get("report");
        if (id) await selectReport(id);
      }
    }
  } catch (err: any) {
    error.value = err.message;
  }
  timer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      if (connected.value) await checkReady();
      if (report.value && !finished.value) {
        const selectedUrl = selectedPage.value?.url,
          selectedViewport = selectedPage.value?.viewport;
        report.value = await api(
          isPublic
            ? "/api/share/" + sharedToken
            : "/api/reports/" + report.value.id,
        );
        selectedPage.value =
          report.value?.pages.find(
            (p) => p.url === selectedUrl && p.viewport === selectedViewport,
          ) ||
          report.value?.pages.find((p) => p.screenshot) ||
          null;
      } else if (!report.value && connected.value) await loadReports();
    } catch (err: any) {
      if (err.name !== "AbortError") error.value = err.message;
    } finally {
      polling = false;
    }
  }, 4000);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeyboard);
  if (timer) clearInterval(timer);
  controller.abort();
});
</script>
