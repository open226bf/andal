import type { Editor } from '@tiptap/core';
import { createContext, useContext, useEffect, useReducer } from 'react';

export interface DocContextValue {
  chapter: string;
  figureOffset: number;
  listingOffset: number;
  editing: boolean;
}

export const DocContext = createContext<DocContextValue>({ chapter: '', figureOffset: 0, listingOffset: 0, editing: false });

export const useDoc = () => useContext(DocContext);

const FIGURES = new Set(['mermaid', 'drawio', 'image']);
const LISTINGS = new Set(['openapi', 'codeBlock']);

/** « Figure 3.2 » ou « Listing 3.1 »: numérotation continue sur tout le chapitre. */
export function useNumber(editor: Editor, getPos: () => number | undefined, kind: 'figure' | 'listing'): string {
  const { chapter, figureOffset, listingOffset } = useDoc();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('update', rerender);
    return () => {
      editor.off('update', rerender);
    };
  }, [editor]);

  const types = kind === 'figure' ? FIGURES : LISTINGS;
  const pos = getPos();
  let index = 0;
  if (typeof pos === 'number') {
    editor.state.doc.descendants((node, nodePos) => {
      if (nodePos > pos) return false;
      if (types.has(node.type.name)) index += 1;
      return true;
    });
  }
  const offset = kind === 'figure' ? figureOffset : listingOffset;
  return `${chapter ? `${chapter}.` : ''}${offset + Math.max(index, 1)}`;
}
