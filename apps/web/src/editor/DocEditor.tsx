import { HocuspocusProvider } from '@hocuspocus/provider';
import { LockSimpleIcon, WifiSlashIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { webExtensions } from './extensions';

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

type Status = 'connecting' | 'synced' | 'denied' | 'offline';

function collabUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;
}

/* Messages « stateless » du serveur collab (voir packages/db/src/collab-commands.ts). Aucun ne porte de donnée. */
/** Les fils de la page ont changé. */
const THREADS_CHANGED = 'threads-changed';
/** Des droits ont changé: la page, le sommaire et le partage sont à relire. */
const ACCESS_CHANGED = 'access-changed';
/** Mes notifications ont changé. */
const NOTIFICATIONS_CHANGED = 'notifications-changed';
/** Un sommaire a changé (page créée, renommée, déplacée): numéros compris. */
const TREE_CHANGED = 'tree-changed';

interface Props {
  pageId: string;
  user: { name: string; color: string };
  editable: boolean;
  onPresence: (users: PresenceUser[]) => void;
  /** L'éditeur n'est transmis qu'une fois le document synchronisé. */
  onEditor: (editor: Editor | null) => void;
  onThreadsChanged: () => void;
}

/**
 * Éditeur collaboratif. Le contenu vient du serveur collab (Yjs), qui vérifie
 * les droits à la connexion: un lecteur reçoit une connexion en lecture seule.
 */
export function DocEditor({ pageId, user, editable, onPresence, onEditor, onThreadsChanged }: Props) {
  // Par une référence: changer de rappel ne doit pas rouvrir la connexion.
  const threadsChanged = useRef(onThreadsChanged);
  threadsChanged.current = onThreadsChanged;
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    setStatus('connecting');
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: `page:${pageId}`,
      // L'authentification passe par le cookie de session; le jeton n'est qu'un marqueur.
      token: 'session-cookie',
      onSynced: () => setStatus('synced'),
      onAuthenticationFailed: () => setStatus('denied'),
      onStateless: ({ payload }) => {
        if (payload === THREADS_CHANGED) threadsChanged.current();
        if (payload === NOTIFICATIONS_CHANGED) void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        if (payload === ACCESS_CHANGED) {
          for (const key of ['page', 'tree', 'projects', 'sharing', 'threads', 'mentionable', 'trash']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
        if (payload === TREE_CHANGED) {
          for (const key of ['page', 'tree', 'projects', 'trash']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
      },
      onStatus: ({ status: s }) => {
        if (s === 'disconnected') setStatus((prev) => (prev === 'synced' ? 'offline' : prev));
        if (s === 'connected') setStatus((prev) => (prev === 'offline' ? 'synced' : prev));
      },
      onAwarenessChange: ({ states }) => {
        const seen = new Map<string, PresenceUser>();
        for (const state of states as { clientId: number; user?: { name: string; color: string } }[]) {
          if (state.user) seen.set(state.user.name, { clientId: state.clientId, ...state.user });
        }
        // L'extension de curseurs écrit l'awareness pendant la création de l'éditeur, donc pendant un rendu.
        const users = [...seen.values()];
        queueMicrotask(() => onPresence(users));
      },
    });
    setProvider(p);
    return () => {
      p.destroy();
      setProvider(null);
      onPresence([]);
    };
  }, [pageId, onPresence, queryClient]);

  if (status === 'denied') {
    return (
      <p className="doc-state">
        <LockSimpleIcon size={18} aria-hidden />
        Le serveur de collaboration a refusé l'accès à cette page.
      </p>
    );
  }
  if (!provider) return <Skeleton />;
  return <CollabEditor key={pageId} pageId={pageId} provider={provider} user={user} editable={editable} synced={status !== 'connecting'} offline={status === 'offline'} onEditor={onEditor} />;
}

function CollabEditor({
  pageId,
  provider,
  user,
  editable,
  synced,
  offline,
  onEditor,
}: {
  pageId: string;
  provider: HocuspocusProvider;
  user: { name: string; color: string };
  editable: boolean;
  synced: boolean;
  offline: boolean;
  onEditor: (editor: Editor | null) => void;
}) {
  const editor = useEditor(
    {
      extensions: webExtensions(provider, user, pageId),
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { 'aria-label': 'Contenu de la page' } },
    },
    [provider],
  );

  useEffect(() => {
    editor?.setEditable(editable && synced);
  }, [editor, editable, synced]);

  useEffect(() => {
    onEditor(synced ? editor : null);
    return () => onEditor(null);
  }, [editor, synced, onEditor]);

  return (
    <>
      {offline && (
        <p className="doc-state">
          <WifiSlashIcon size={18} aria-hidden />
          Connexion perdue: les modifications seront envoyées au retour du réseau.
        </p>
      )}
      {!synced && <Skeleton />}
      <EditorContent editor={editor} hidden={!synced} />
    </>
  );
}

function Skeleton() {
  return (
    <div className="doc-skeleton" aria-busy="true" aria-label="Chargement de la page">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
