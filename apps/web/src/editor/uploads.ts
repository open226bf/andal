import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useSyncExternalStore } from 'react';
import { errorMessage, uploadFile } from '../lib/api';

/* ---------- État des envois, affiché dans la barre d'insertion ---------- */

export interface UploadState {
  /** Fichiers en cours d'envoi. */
  pending: number;
  /** Dernier échec, jusqu'à ce qu'on le ferme ou qu'un nouvel envoi réussisse. */
  error: string | null;
}

let state: UploadState = { pending: 0, error: null };
const listeners = new Set<() => void>();

function update(next: Partial<UploadState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function useUploads(): UploadState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function dismissUploadError() {
  update({ error: null });
}

/* ---------- Envoi et insertion ---------- */

/** « schema-reseau » pour « schema-reseau.png »: un premier texte alternatif, à corriger. */
function altFrom(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').trim();
}

/**
 * Envoie les fichiers un par un, puis les insère là où se trouve le curseur:
 * une image devient une figure, le reste une pièce jointe à télécharger.
 */
export async function insertFiles(editor: Editor, pageId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  update({ pending: state.pending + files.length, error: null });
  for (const file of files) {
    try {
      const uploaded = await uploadFile(pageId, file);
      if (editor.isDestroyed || !editor.isEditable) continue;
      const node: JSONContent = uploaded.image
        ? { type: 'image', attrs: { fileId: uploaded.id, alt: altFrom(uploaded.name), caption: null } }
        : { type: 'attachment', attrs: { fileId: uploaded.id, name: uploaded.name, size: uploaded.size, contentType: uploaded.contentType } };
      editor.chain().focus().insertContent(node).run();
    } catch (error) {
      update({ error: `${file.name}: ${errorMessage(error)}` });
    } finally {
      update({ pending: Math.max(0, state.pending - 1) });
    }
  }
}

/** Fenêtre de choix de fichiers, puis envoi. */
export function pickFiles(editor: Editor, pageId: string, accept?: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  input.addEventListener('change', () => void insertFiles(editor, pageId, [...(input.files ?? [])]));
  input.click();
}

/** Le presse-papiers ne porte qu'une image (capture d'écran, « Copier l'image »), sans texte à coller. */
function onlyFiles(data: DataTransfer): boolean {
  if (data.files.length === 0) return false;
  const html = data.getData('text/html');
  if (!html) return true;
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
  return text.length === 0;
}

/** Coller ou déposer des fichiers dans la page les envoie. */
export const FileDrop = Extension.create<{ pageId: string }>({
  name: 'fileDrop',
  addOptions() {
    return { pageId: '' };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const pageId = this.options.pageId;
    return [
      new Plugin({
        key: new PluginKey('fileDrop'),
        props: {
          handlePaste: (_view, event) => {
            if (!editor.isEditable || !event.clipboardData || !onlyFiles(event.clipboardData)) return false;
            event.preventDefault();
            void insertFiles(editor, pageId, [...event.clipboardData.files]);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !editor.isEditable || !event.dataTransfer?.files.length) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) editor.commands.setTextSelection(at.pos);
            void insertFiles(editor, pageId, [...event.dataTransfer.files]);
            return true;
          },
        },
      }),
    ];
  },
});
