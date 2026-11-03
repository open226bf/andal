import { CodeIcon, FlowArrowIcon, GraphIcon, LightbulbIcon, ListBulletsIcon, QuotesIcon, TextBIcon, TextHTwoIcon, TextItalicIcon } from '@phosphor-icons/react';
import { useEditorState, type Editor } from '@tiptap/react';

/** Barre du mode édition: mise en forme et insertion des blocs techniques. */
export function InsertBar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      list: e.isActive('bulletList'),
      quote: e.isActive('blockquote'),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <div className="insert-bar" role="toolbar" aria-label="Mise en forme et insertion">
      <Tool label="Gras" active={state.bold} onClick={() => chain().toggleBold().run()} icon={<TextBIcon size={18} />} />
      <Tool label="Italique" active={state.italic} onClick={() => chain().toggleItalic().run()} icon={<TextItalicIcon size={18} />} />
      <Tool label="Titre" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} icon={<TextHTwoIcon size={18} />} />
      <Tool label="Liste" active={state.list} onClick={() => chain().toggleBulletList().run()} icon={<ListBulletsIcon size={18} />} />
      <Tool label="Citation" active={state.quote} onClick={() => chain().toggleBlockquote().run()} icon={<QuotesIcon size={18} />} />
      <span className="sep" aria-hidden />
      <Tool label="Code" onClick={() => chain().setCodeBlock({ language: 'bash' }).run()} icon={<CodeIcon size={18} />} text />
      <Tool
        label="Encadré"
        onClick={() => chain().insertContent({ type: 'callout', attrs: { tone: 'note', title: 'À retenir' }, content: [{ type: 'paragraph' }] }).run()}
        icon={<LightbulbIcon size={18} />}
        text
      />
      <Tool
        label="Mermaid"
        onClick={() => chain().insertContent({ type: 'mermaid', attrs: { source: 'flowchart LR\n  A[Début] --> B[Fin]', caption: 'Nouvelle figure.' } }).run()}
        icon={<GraphIcon size={18} />}
        text
      />
      <Tool label="draw.io" onClick={() => chain().insertContent({ type: 'drawio', attrs: { src: '', caption: 'Nouveau schéma.' } }).run()} icon={<FlowArrowIcon size={18} />} text />
    </div>
  );
}

function Tool({ label, icon, onClick, active, text }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; text?: boolean }) {
  return (
    <button type="button" className="tool" data-active={active ? 'true' : undefined} aria-pressed={active} aria-label={text ? undefined : label} title={text ? undefined : label} onClick={onClick}>
      {icon}
      {text && label}
    </button>
  );
}
