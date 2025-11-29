<template>
  <div class="container">
    <h1>Analizzatore di Siti Web</h1>
    <p class="subtitle">Scopri cosa rende unico il design di qualsiasi sito web. Usa l'intelligenza artificiale per capire layout, colori e user experience in pochi secondi!</p>

    <div v-if="!loading && !result" class="input-group">
      <label for="url-input">Inserisci l'URL del sito</label>
      <input
        id="url-input"
        type="url"
        v-model="url"
        :class="{ invalid: validationError }"
        placeholder="https://tuositopreferito.com"
        @input="validateUrl"
        @keyup.enter="submitCrawl"
      />
      <p v-if="validationError" class="error-text">{{ validationError }}</p>
    </div>

    <button
      v-if="!loading && !result"
      class="btn"
      :disabled="!isUrlValid || submitting"
      @click="submitCrawl"
    >
      {{ submitting ? 'Un attimo...' : 'Analizza Ora' }}
    </button>

    <div v-if="loading" class="loader">
      <div class="spinner"></div>
      <p class="loader-text">{{ getLoadingMessage() }}</p>
      <p class="loader-time">{{ pollingAttempts }}s trascorsi</p>
    </div>

    <div v-if="result" class="result">
      <div v-if="result.status === 'done' && result.result">
        <h2>Analisi Completata!</h2>
        <p class="url-info">URL analizzato: {{ result.result.url }}</p>
        
        <img
          v-if="result.result && result.result.image"
          :src="result.result.image"
          alt="Screenshot del sito web"
          class="screenshot"
        />
        
        <div class="description" v-html="formatDescription(result.result.description)"></div>
        
        <p class="meta">Analisi completata in {{ (result.result.tookMs / 1000).toFixed(1) }} secondi</p>
        
        <button class="btn" @click="reset">Analizza un altro sito</button>
      </div>

      <div v-else-if="result.status === 'error'" class="error-result">
        <h2>Ops, qualcosa è andato storto</h2>
        <p>{{ getErrorMessage(result.message || '') }}</p>
        <button class="btn retry-btn" @click="reset">Riprova</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface CrawlResult {
  status: 'pending' | 'done' | 'error';
  result?: {
    url: string;
    description: string;
    image: string;
    tookMs: number;
  };
  message?: string;
}

const url = ref('');
const validationError = ref('');
const submitting = ref(false);
const loading = ref(false);
const result = ref<CrawlResult | null>(null);
const pollingAttempts = ref(0);

const isUrlValid = computed(() => {
  return url.value && !validationError.value;
});

function getLoadingMessage() {
  // pollingAttempts is approximate seconds elapsed
  if (pollingAttempts.value < 3) return 'In coda per l\'elaborazione...';
  if (pollingAttempts.value < 8) return 'Sto catturando lo screenshot del sito...';
  if (pollingAttempts.value < 12) return 'L\'intelligenza artificiale sta analizzando il design...';
  if (pollingAttempts.value < 18) return 'Rilevo layout, colori e tipografia...';
  if (pollingAttempts.value < 26) return 'Sto sintetizzando i punti principali e i suggerimenti...';
  if (pollingAttempts.value < 35) return 'Quasi fatto, sto preparando i risultati...';
  return 'Ultimi ritocchi all\'analisi...';
}

function getErrorMessage(msg: string) {
  if (msg.includes('robots')) {
    return 'Questo sito non permette l\'analisi automatica (robots.txt)';
  }
  if (msg.includes('timeout')) {
    return 'Il sito ci ha messo troppo a rispondere. Riprova!';
  }
  if (msg.includes('auth')) {
    return 'Questo sito richiede autenticazione';
  }
  return `Errore: ${msg}`;
}

function validateUrl() {
  validationError.value = '';
  
  if (!url.value) {
    return;
  }
  
  try {
    const urlObj = new URL(url.value);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      validationError.value = 'L\'URL deve iniziare con http:// o https://';
    }
  } catch {
    validationError.value = 'Inserisci un URL valido (es: https://example.com)';
  }
}

async function submitCrawl() {
  if (!isUrlValid.value || submitting.value) return;
  
  submitting.value = true;
  
  try {
    const response = await fetch('/crawl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url.value })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to submit crawl request');
    }
    
    const data = await response.json();
    const uid = data.uid;
    
    loading.value = true;
    submitting.value = false;
    
    // Start polling
    await pollCrawlStatus(uid);
  } catch (error: any) {
    submitting.value = false;
    alert('Error: ' + error.message);
  }
}

async function pollCrawlStatus(uid: string) {
  let attempts = 0;
  const maxAttempts = 30;
  let delay = 2000;
  const maxDelay = 30000;
  
  while (attempts < maxAttempts) {
    try {
      pollingAttempts.value = Math.floor((attempts * delay) / 1000);
      
      const response = await fetch(`/crawl/${uid}`);
      const data: CrawlResult = await response.json();
      
      if (data.status === 'done' || data.status === 'error') {
        result.value = data;
        loading.value = false;
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
      attempts++;
    } catch (error) {
      console.error('Polling error:', error);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempts++;
    }
  }
  
  result.value = {
    status: 'error',
    message: 'timeout'
  };
  loading.value = false;
}

function reset() {
  url.value = '';
  validationError.value = '';
  submitting.value = false;
  loading.value = false;
  result.value = null;
  pollingAttempts.value = 0;
}

function formatDescription(text: string): string {
  if (!text) return '';

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const formatInline = (s: string) => {
    // temporarily mark bold segments to avoid escaping them
    const placeholderStart = '__BOLD_START__';
    const placeholderEnd = '__BOLD_END__';
    let tmp = s.replace(/\*\*(.*?)\*\*/g, (_m, p1) => placeholderStart + p1 + placeholderEnd);

    // escape HTML then restore bold and convert links
    let escaped = escapeHtml(tmp);
    escaped = escaped.replace(new RegExp(placeholderStart + '(.*?)' + placeholderEnd, 'g'), '<strong>$1</strong>');
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return escaped;
  };

  // Normalize line endings and split into blocks separated by empty lines
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/g).map(b => b.trim()).filter(Boolean);

  const html = blocks.map(block => {
    const lines = block.split(/\n+/).map(l => l.trim()).filter(Boolean);

    // unordered list: lines starting with - or *
    if (lines.every(l => /^[-*]\s+/.test(l))) {
      const items = lines.map(l => `<li>${formatInline(l.replace(/^[-*]\s+/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    // ordered list: lines like 1. item
    if (lines.every(l => /^\d+\.\s+/.test(l))) {
      const items = lines.map(l => `<li>${formatInline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    // single-line heading in the form **Heading** or **Heading**:
    if (lines.length === 1) {
      const headingMatch = lines[0].match(/^\*\*(.+?)\*\*:?$/);
      if (headingMatch) {
        return `<h3 class="desc-section">${escapeHtml(headingMatch[1])}</h3>`;
      }
    }

    // default: paragraph (keep inner inline formatting)
    return `<p>${formatInline(block)}</p>`;
  }).join('');

  return html;
}
</script>
