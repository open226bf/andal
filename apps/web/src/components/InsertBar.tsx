import {
  BracketsCurlyIcon,
  CodeIcon,
  ColumnsPlusRightIcon,
  FlowArrowIcon,
  GraphIcon,
  ImageIcon,
  LightbulbIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListChecksIcon,
  MinusIcon,
  PaperclipIcon,
  QuotesIcon,
  RowsPlusBottomIcon,
  SpinnerGapIcon,
  TableIcon,
  TextBIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type {} from '@tiptap/extension-table';
import { useEditorState, type Editor } from '@tiptap/react';
import { dismissUploadError, pickFiles, useUploads } from '../editor/uploads';

/** Barre du mode édition: mise en forme, insertion des blocs, fichiers et tableaux. */
export function InsertBar({ editor, pageId, onLink, onSpec }: { editor: Editor; pageId: string; onLink: () => void; onSpec: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      list: e.isActive('bulletList'),
      tasks: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  });
  const uploads = useUploads();
  const chain = () => editor.chain().focus();

  return (
    <div className="insert-bar" role="toolbar" aria-label="Mise en forme et insertion">
      <Tool label="Gras" active={state.bold} onClick={() => chain().toggleBold().run()} icon={<TextBIcon size={18} />} />
      <Tool label="Italique" active={state.italic} onClick={() => chain().toggleItalic().run()} icon={<TextItalicIcon size={18} />} />
      <Tool label="Titre" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} icon={<TextHTwoIcon size={18} />} />
      <Tool label="Liste" active={state.list} onClick={() => chain().toggleBulletList().run()} icon={<ListBulletsIcon size={18} />} />
      <Tool label="Liste de tâches" active={state.tasks} onClick={() => chain().toggleTaskList().run()} icon={<ListChecksIcon size={18} />} />
      <Tool label="Citation" active={state.quote} onClick={() => chain().toggleBlockquote().run()} icon={<QuotesIcon size={18} />} />
      <Tool label="Lien (⌘K)" active={state.link} onClick={onLink} icon={<LinkSimpleIcon size={18} />} />
      <span className="sep" aria-hidden />
      <Tool label="Image" onClick={() => pickFiles(editor, pageId, 'image/*')} icon={<ImageIcon size={18} />} text />
      <Tool label="Fichier" onClick={() => pickFiles(editor, pageId)} icon={<PaperclipIcon size={18} />} text />
      <Tool label="Tableau" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={<TableIcon size={18} />} text />
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
      <Tool label="OpenAPI" onClick={onSpec} icon={<BracketsCurlyIcon size={18} />} text />
      <Tool label="draw.io" onClick={() => chain().insertContent({ type: 'drawio', attrs: { src: '', caption: 'Nouveau schéma.' } }).run()} icon={<FlowArrowIcon size={18} />} text />
      {state.table && (
        <span className="tool-group" role="group" aria-label="Tableau">
          <span className="sep" aria-hidden />
          <Tool label="Ajouter une ligne en dessous" onClick={() => chain().addRowAfter().run()} icon={<RowsPlusBottomIcon size={18} />} />
          <Tool label="Ajouter une colonne à droite" onClick={() => chain().addColumnAfter().run()} icon={<ColumnsPlusRightIcon size={18} />} />
          <Tool label="Ligne" onClick={() => chain().deleteRow().run()} icon={<MinusIcon size={16} aria-label="Supprimer la" />} text />
          <Tool label="Colonne" onClick={() => chain().deleteColumn().run()} icon={<MinusIcon size={16} aria-label="Supprimer la" />} text />
          <Tool label="Ligne d'en-tête" onClick={() => chain().toggleHeaderRow().run()} icon={<TableIcon size={18} weight="duotone" />} />
          <Tool label="Supprimer le tableau" onClick={() => chain().deleteTable().run()} icon={<TrashIcon size={18} />} />
        </span>
      )}
      {uploads.pending > 0 && (
        <span className="upload-state" role="status">
          <SpinnerGapIcon size={16} className="spin" aria-hidden />
          Envoi de {uploads.pending} fichier{uploads.pending > 1 ? 's' : ''}…
        </span>
      )}
      {uploads.error && (
        <span className="upload-state error" role="alert">
          <WarningCircleIcon size={16} aria-hidden />
          {uploads.error}
          <button type="button" className="icon-btn xs" aria-label="Fermer" onClick={dismissUploadError}>
            <XIcon size={14} aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}

function Tool({ label, icon, onClick, active, text }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; text?: boolean }) {
  return (
    <button
      type="button"
      className="tool"
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      aria-label={text ? undefined : label}
      title={text ? undefined : label}
      // Le focus reste dans le texte: sinon l'éditeur, en le reprenant, revient à son ancienne sélection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
      {text && label}
    </button>
  );
}
