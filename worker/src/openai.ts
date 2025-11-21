import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const PROMPT = `Analizza questo sito web come se fossi un designer esperto. Descrivi in modo semplice e colloquiale:
- Come è organizzato il layout
- Quali colori usa e che sensazione danno
- Come sono disposti i testi e le immagini
- Quanto è facile da navigare
- Cosa funziona bene e cosa potrebbe essere migliorato

Scrivi in modo naturale, come se stessi parlando con un amico che vuole capire il design del sito.`;

export async function analyzeScreenshot(screenshot: Buffer): Promise<string> {
  if (!openai) {
    throw new Error('Chiave API OpenAI non configurata');
  }
  
  if (process.env.OPENAI_MOCK === '1') {
    return 'Sito con design moderno e pulito. Layout equilibrato con buona gerarchia visiva. Colori neutri con accenti per richiamare l\'attenzione. Tipografia leggibile e spaziatura ben gestita. Navigazione intuitiva secondo gli standard web.';
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
              detail: 'high'
            }
          }
        ]
      }],
      max_tokens: 500
    });
    
    return response.choices[0]?.message?.content || 'Analisi non disponibile';
  } catch (error) {
    console.error('Errore OpenAI:', error);
    throw new Error('Impossibile analizzare lo screenshot');
  }
}
