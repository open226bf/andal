import { Avatar } from '@andal/ui';
import { BellIcon, ChecksIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { api, errorMessage, useNotifications, type NotificationItem } from '../lib/api';
import { relative } from '../lib/format';
import { t, tn, tx } from '../lib/i18n';
import { FormError } from './AuthCard';

/** La phrase entière, l'auteur en placeholder: l'ordre des mots change selon la langue. */
const VERB: Record<NotificationItem['kind'], (actor: ReactNode) => ReactNode> = {
  mention: (actor) => tx('{actor} vous a cité', { actor }),
  reply: (actor) => tx('{actor} a répondu dans un fil que vous suivez', { actor }),
  resolved: (actor) => tx('{actor} a résolu votre fil', { actor }),
};

/**
 * La cloche de l'étagère: citations, réponses dans vos fils, fils résolus.
 * Ouvrir une notification la marque comme lue et mène au fil, sur sa page.
 */
export function NotificationsButton() {
  const { data } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = data?.unread ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = async (ids?: string[]) => {
    setError(null);
    try {
      await api('/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });
    } catch (err) {
      setError(errorMessage(err));
    }
    await refresh();
  };

  const openItem = (item: NotificationItem) => {
    setOpen(false);
    if (!item.read) void markRead([item.id]);
    void navigate({ to: '/v/$slug/$pageId', params: { slug: item.page.slug, pageId: item.page.id }, search: { fil: item.threadId } });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="bell" aria-label={unread ? tn(unread, 'Notifications, {n} non lue', 'Notifications, {n} non lues') : t('Notifications')}>
          <BellIcon size={22} aria-hidden />
          {unread > 0 && (
            <span className="bell-count" aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop inbox" side="right" align="end" sideOffset={10} collisionPadding={16}>
          <div className="pop-head">
            <h2>{t('Notifications')}</h2>
            {unread > 0 && (
              <button type="button" className="ghost" onClick={() => void markRead()}>
                <ChecksIcon size={16} aria-hidden />
                {t('Tout marquer comme lu')}
              </button>
            )}
          </div>
          {error && (
            <div className="share-error">
              <FormError>{error}</FormError>
            </div>
          )}
          {data && data.items.length === 0 ? (
            <p className="inbox-empty">{t('Rien de neuf. Quand quelqu’un vous cite (@identifiant) ou répond dans un de vos fils, c’est ici.')}</p>
          ) : (
            <ul className="inbox-list" aria-busy={!data}>
              {data?.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="inbox-item" data-unread={item.read ? undefined : 'true'} data-vol={item.page.cloth} onClick={() => openItem(item)}>
                    {item.actor ? <Avatar initials={item.actor.initials} color={item.actor.color} size={30} /> : <span className="av-blank" aria-hidden />}
                    <span className="inbox-text">
                      <span>{VERB[item.kind](<b>{item.actor?.name ?? t('Quelqu’un')}</b>)}</span>
                      <span className="inbox-where">
                        <span className="vol-swatch" aria-hidden />
                        {item.page.title} · {item.page.shortName}
                      </span>
                      {item.excerpt && <q>{item.excerpt}</q>}
                    </span>
                    <time dateTime={item.createdAt}>{relative(item.createdAt)}</time>
                    {!item.read && <span className="sr-only">{t('non lue')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data?.email.available && (
            <label className="inbox-foot">
              <input
                type="checkbox"
                checked={data.email.enabled}
                onChange={async (e) => {
                  setError(null);
                  try {
                    await api('/notifications/email', { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) });
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                  await refresh();
                }}
              />
              <span>
                {t('Aussi par email')}
                <small>{t('Seulement ce que vous n’avez pas lu ici dans les minutes qui suivent, regroupé en un message.')}</small>
              </span>
            </label>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
