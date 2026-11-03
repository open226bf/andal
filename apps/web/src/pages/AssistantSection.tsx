import { SparkleIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError, FormOk } from '../components/AuthCard';
import { api, errorMessage } from '../lib/api';
import { t } from '../lib/i18n';

type AiState = { configured: false } | { configured: true; source: 'admin' | 'env'; enabled: boolean; provider: 'anthropic' | 'openai'; model: string; baseUrl: string | null; hasApiKey: boolean };

const PRESETS = {
  anthropic: { model: 'claude-opus-5-5', baseUrl: '', help: t('Claude, par l’API d’Anthropic. Sans clé ici, le serveur utilise ANTHROPIC_API_KEY. Si un classifieur de sécurité décline une question, l’API la relance sur le modèle de repli recommandé.') },
  openai: { model: 'llama3.1', baseUrl: 'http://ollama:11434/v1', help: t('Toute API compatible OpenAI: un modèle local (Ollama, LM Studio, vLLM), auto-hébergé ou chez un autre fournisseur. Les pages ne quittent alors pas votre réseau.') },
} as const;

/**
 * Assistant de questions-réponses: le modèle qui rédige les réponses.
 * Il ne reçoit que des extraits des pages que la personne qui demande peut lire.
 */
export function AssistantSection() {
  const queryClient = useQueryClient();
  const ai = useQuery({ queryKey: ['admin', 'ai'], queryFn: () => api<AiState>('/admin/ai') });
  const [form, setForm] = useState<{ enabled: boolean; provider: 'anthropic' | 'openai'; model: string; baseUrl: string; apiKey: string }>({ enabled: true, provider: 'anthropic', model: PRESETS.anthropic.model, baseUrl: '', apiKey: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ai.data?.configured) setForm({ enabled: ai.data.enabled, provider: ai.data.provider, model: ai.data.model, baseUrl: ai.data.baseUrl ?? '', apiKey: '' });
  }, [ai.data]);

  if (ai.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement')}><span /><span /></div>;
  const data = ai.data;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await api('/admin/ai', { method: 'PUT', body: JSON.stringify({ enabled: form.enabled, provider: form.provider, model: form.model, baseUrl: form.baseUrl || null, ...(form.apiKey ? { apiKey: form.apiKey } : {}) }) });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'ai'] });
      await queryClient.invalidateQueries({ queryKey: ['ask'] });
      setForm((f) => ({ ...f, apiKey: '' }));
      setNotice(form.enabled ? t('Enregistré. La recherche (⌘K) propose maintenant de poser une question.') : t('Enregistré: l’assistant est éteint.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const test = async () => {
    setError(null);
    setNotice(t('Question de test envoyée…'));
    try {
      const result = await api<{ ok: boolean; sample?: string; error?: string; durationMs: number }>('/admin/ai/test', { method: 'POST' });
      if (result.ok) setNotice(t('Le modèle répond (« {sample} », en {seconds} s).', { sample: result.sample, seconds: (result.durationMs / 1000).toFixed(1) }));
      else {
        setNotice(null);
        setError(result.error ?? t('Le modèle a décliné la question de test.'));
      }
    } catch (err) {
      setNotice(null);
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">{t('Assistant')}</h1>
          <p className="admin-count">
            {data?.configured
              ? data.enabled
                ? data.source === 'env'
                  ? t('Actif · {model} (réglé par le serveur)', { model: data.model })
                  : t('Actif · {model}', { model: data.model })
                : t('Éteint')
              : t('Pas encore réglé')}
          </p>
        </div>
      </div>
      <div className="assistant-intro">
        <SparkleIcon size={22} aria-hidden />
        <p>
          {t('Dans la recherche (⌘K), une question obtient une réponse rédigée qui cite ses pages. Le modèle ne reçoit que des extraits des pages que la personne qui demande peut lire; les pages sous restriction restent hors de portée de qui ne les lit pas. 40 questions par personne et par heure.')}
        </p>
      </div>
      <form className="assistant-form" onSubmit={(e) => void submit(e)}>
        {error && <FormError>{error}</FormError>}
        {notice && <FormOk>{notice}</FormOk>}
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          {t('Assistant activé')}
        </label>
        <fieldset className="field">
          <legend>{t('Fournisseur')}</legend>
          {(['anthropic', 'openai'] as const).map((p) => (
            <label key={p} className="check">
              <input
                type="radio"
                name="provider"
                checked={form.provider === p}
                onChange={() => setForm({ ...form, provider: p, model: PRESETS[p].model, baseUrl: PRESETS[p].baseUrl })}
              />
              {p === 'anthropic' ? 'Claude (Anthropic)' : t('API compatible OpenAI, locale comprise')}
            </label>
          ))}
          <p className="field-help">{PRESETS[form.provider].help}</p>
        </fieldset>
        <div className="git-row">
          <div className="field">
            <label htmlFor="ai-model">{t('Modèle')}</label>
            <input id="ai-model" className="input" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ai-url">{t('Adresse de l’API')}</label>
            <input id="ai-url" className="input" placeholder={form.provider === 'anthropic' ? t('Par défaut: api.anthropic.com') : 'http://ollama:11434/v1'} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ai-key">{t('Clé d’API')}</label>
          <input id="ai-key" className="input" type="password" autoComplete="off" placeholder={data?.configured && data.hasApiKey ? t('Inchangée') : form.provider === 'openai' ? t('Souvent inutile pour un modèle local') : t('Facultative si ANTHROPIC_API_KEY est défini')} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </div>
        <div className="dialog-actions">
          {data?.configured && (
            <button type="button" className="btn-line" onClick={() => void test()}>
              {t('Tester')}
            </button>
          )}
          <button type="submit" className="btn-ink" disabled={pending}>
            {t('Enregistrer')}
          </button>
        </div>
      </form>
    </>
  );
}
