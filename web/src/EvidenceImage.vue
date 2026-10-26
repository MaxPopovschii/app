<template>
  <div class="evidence-image"><img v-if="src" :src="src" :alt="alt" loading="lazy"/><p v-else>{{ failed ? 'Prova non disponibile' : 'Caricamento prova…' }}</p></div>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
const props = defineProps<{ url: string; token?: string; alt: string }>();
const src = ref(''), failed = ref(false); let controller: AbortController | undefined;
watch(() => [props.url, props.token], async () => {
  controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  if (src.value) URL.revokeObjectURL(src.value); src.value = ''; failed.value = false;
  try {
    const response = await fetch(props.url, { headers: props.token ? { Authorization: 'Bearer ' + props.token } : {}, signal });
    if (!response.ok) throw new Error(); const blob = await response.blob();
    if (!signal.aborted) src.value = URL.createObjectURL(blob);
  } catch { if (!signal.aborted) failed.value = true; }
}, { immediate: true });
onBeforeUnmount(() => { controller?.abort(); if (src.value) URL.revokeObjectURL(src.value); });
</script>
