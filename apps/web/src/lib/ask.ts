import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type Cloth } from './api';
import { locale } from './i18n';

export interface AskSource {
  n: number;
  id: string;
  title: string;
  number: string;
  project: { slug: string; shortName: string; cloth: Cloth };
}

export const useAskStatus = () => useQuery({ queryKey: ['ask', 'status'], queryFn: () => api<{ enabled: boolean; model: string | null }>('/ask/status'), staleTime: 60_000 });

/**
 * Pose une question à l'assistant et lit sa réponse au fil de l'eau
 * (server-sent events: sources, delta, done ou error).
 */
export async function askStream(question: string, handlers: { onSources: (s: AskSource[]) => void; onText: (t: string) => void }, signal: AbortSignal): Promise<{ truncated: boolean }> {
  const response = await fetch('/api/ask', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'accept-language': locale },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Corps non JSON.
    }
    throw new ApiError(response.status, message);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data) as unknown;
      if (event === 'sources') handlers.onSources(parsed as AskSource[]);
      else if (event === 'delta') handlers.onText((parsed as { text: string }).text);
      else if (event === 'error') throw new ApiError(502, (parsed as { message: string }).message);
      else if (event === 'done') return { truncated: Boolean((parsed as { truncated?: boolean }).truncated) };
    }
  }
  return { truncated: false };
}
