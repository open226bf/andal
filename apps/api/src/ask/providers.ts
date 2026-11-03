import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '@andal/db';

export interface AiSettings {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
}

export interface Generation {
  /** 'refusal': le modèle a décliné (classifieurs de sécurité de Claude). */
  outcome: 'ok' | 'refusal' | 'truncated';
}

/** Les modèles Claude qui prennent `output_config.effort`. */
const EFFORT = /^claude-(opus-5|sonnet-5|haiku-5|fable-5|mythos-5|opus-4-[5-8])/;
/** Les modèles Claude qui acceptent le repli serveur `fallbacks: "default"` (Claude API seulement). */
const FALLBACK = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

/**
 * Génère la réponse en flux. Claude passe par le SDK officiel; « openai »
 * vise toute API compatible (OpenAI, Mistral, et les modèles locaux:
 * Ollama, LM Studio, vLLM…), choisie par les admins de l'espace.
 */
export async function generate(settings: AiSettings, system: string, user: string, onText: (text: string) => void, signal: AbortSignal): Promise<Generation> {
  return settings.provider === 'anthropic' ? generateClaude(settings, system, user, onText, signal) : generateCompatible(settings, system, user, onText, signal);
}

async function generateClaude(settings: AiSettings, system: string, user: string, onText: (text: string) => void, signal: AbortSignal): Promise<Generation> {
  // Sans clé enregistrée, le SDK lit ANTHROPIC_API_KEY (ou un profil `ant auth login`).
  const client = new Anthropic({ ...(settings.apiKey ? { apiKey: settings.apiKey } : {}), ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}), maxRetries: 2 });
  const fallback = FALLBACK.test(settings.model) && !settings.baseUrl;
  const stream = client.beta.messages.stream(
    {
      model: settings.model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
      // Questions sur la documentation: un effort moyen suffit, et répond vite.
      ...(EFFORT.test(settings.model) ? { output_config: { effort: 'medium' as const } } : {}),
      // Si les classifieurs de sécurité déclinent, l'API relance sur le modèle de repli recommandé.
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
  }
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') return { outcome: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { outcome: 'truncated' };
  return { outcome: 'ok' };
}

/** API « chat/completions » compatible OpenAI, en flux (server-sent events). */
async function generateCompatible(settings: AiSettings, system: string, user: string, onText: (text: string) => void, signal: AbortSignal): Promise<Generation> {
  const base = (settings.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model: settings.model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Le modèle a répondu ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let finish: string | null = null;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return { outcome: finish === 'length' ? 'truncated' : 'ok' };
      try {
        const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
        const choice = parsed.choices?.[0];
        if (choice?.delta?.content) onText(choice.delta.content);
        if (choice?.finish_reason) finish = choice.finish_reason;
      } catch {
        // Ligne incomplète ou commentaire: ignorée.
      }
    }
  }
  return { outcome: finish === 'length' ? 'truncated' : 'ok' };
}
