import type { Editor } from '@tiptap/react';
import { absolutePositionToRelativePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';

/** Passage sélectionné qui peut recevoir un commentaire. */
export interface CommentTarget {
  from: number;
  to: number;
  text: string;
  /** Copie de la plage du DOM, pour la garder surlignée pendant la saisie. */
  range: Range;
  rect: DOMRect;
}

/**
 * Lit la sélection du navigateur plutôt que celle de l'éditeur: elle existe
 * aussi en mode lecture, où l'éditeur n'est pas modifiable.
 * Le passage doit tenir dans un seul bloc de texte qui accepte les commentaires
 * (pas un bloc de code, pas une figure): le serveur collab applique la même règle.
 */
export function commentableSelection(editor: Editor): CommentTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const root = editor.view.dom;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let from: number;
  let to: number;
  try {
    from = editor.view.posAtDOM(range.startContainer, range.startOffset);
    to = editor.view.posAtDOM(range.endContainer, range.endOffset);
  } catch {
    return null;
  }
  if (from > to) [from, to] = [to, from];
  if (to <= from) return null;

  const { doc, schema } = editor.state;
  const comment = schema.marks.comment;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!comment || !$from.sameParent($to) || !$from.parent.isTextblock || !$from.parent.type.allowsMarkType(comment)) return null;
  const text = doc.textBetween(from, to, ' ').trim();
  if (!text) return null;
  return { from, to, text, range: range.cloneRange(), rect: range.getBoundingClientRect() };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Positions relatives Yjs, en base64: elles suivent le texte même s'il bouge avant l'envoi. */
export function relativeAnchor(editor: Editor, from: number, to: number): { from: string; to: string } | null {
  const sync = ySyncPluginKey.getState(editor.state);
  if (!sync?.binding) return null;
  const encode = (pos: number) => toBase64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping)));
  return { from: encode(from), to: encode(to) };
}
