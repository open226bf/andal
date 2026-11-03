import { Callout, CommentMark, DrawioBlock, InlineCode, MermaidBlock, OpenApiBlock } from '@andal/editor';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Extension, type AnyExtension } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { CalloutView, CodeView, DrawioView, MermaidView, OpenApiView } from './nodes';

/**
 * Paragraphe vide après un bloc final (figure, encadré…), pour pouvoir écrire
 * en dessous. Remplace celui de StarterKit, qui l'ajoutait dès la
 * synchronisation: ouvrir une page avec le droit d'écriture créait une
 * version à votre nom. Ici, seulement à la suite d'une modification locale.
 */
const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (transactions, _before, state) => {
          // Les transactions de y-prosemirror (synchronisation, modifications des autres) portent sa méta.
          const local = transactions.some((tr) => tr.docChanged && !tr.getMeta(ySyncPluginKey));
          const paragraph = state.schema.nodes.paragraph;
          const last = state.doc.lastChild;
          if (!local || !editor.isEditable || !paragraph || !last || last.type === paragraph) return null;
          return state.tr.insert(state.doc.content.size, paragraph.create());
        },
      }),
    ];
  },
});

/**
 * Mêmes nœuds que @andal/editor (le schéma est identique à celui du serveur),
 * avec des vues React en plus, et la collaboration Yjs.
 */
/** Les nœuds de la page et leurs vues React, sans synchronisation. */
function documentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [2, 3] }, undoRedo: false, codeBlock: false, code: false, trailingNode: false }),
    InlineCode,
    CodeBlock.extend({ addNodeView: () => ReactNodeViewRenderer(CodeView) }),
    MermaidBlock.extend({ addNodeView: () => ReactNodeViewRenderer(MermaidView) }),
    OpenApiBlock.extend({ addNodeView: () => ReactNodeViewRenderer(OpenApiView) }),
    DrawioBlock.extend({ addNodeView: () => ReactNodeViewRenderer(DrawioView) }),
    Callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
    CommentMark,
  ];
}

export function webExtensions(provider: HocuspocusProvider, user: { name: string; color: string }): AnyExtension[] {
  return [...documentExtensions(), TrailingParagraph, Collaboration.configure({ document: provider.document }), CollaborationCaret.configure({ provider, user })];
}

/** Une ancienne version, en lecture seule: même rendu que la page, sans connexion au serveur collab. */
export function readExtensions(): AnyExtension[] {
  return documentExtensions();
}
