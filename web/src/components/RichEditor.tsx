import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from 'tiptap-markdown';
import markPlugin from 'markdown-it-mark';
import insPlugin from 'markdown-it-ins';
import { Bold, Check, ChevronDown, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, Pilcrow, Underline as UnderlineIcon, X } from 'lucide-react';

// Underline and highlight are stored as ++text++ and ==text== so posts stay plain Markdown.
const MdUnderline = Underline.extend({
  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: 'ins' }];
  },
  addStorage() {
    return { markdown: { serialize: { open: '++', close: '++', mixable: true, expelEnclosingWhitespace: true }, parse: { setup: (m: any) => m.use(insPlugin) } } };
  },
});
const MdHighlight = Highlight.extend({
  addStorage() {
    return { markdown: { serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true }, parse: { setup: (m: any) => m.use(markPlugin) } } };
  },
});

export const getMarkdown = (editor: Editor) => ((editor.storage as any).markdown.getMarkdown() as string).trim();

function Btn({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={!!on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${on ? 'bg-accent text-white' : 'text-muted hover:bg-raised hover:text-text'}`}>
      {children}
    </button>
  );
}

interface Option { label: string; icon: React.ReactNode; on: boolean; run: () => void }

/** Toolbar dropdown: shows the active option's icon, opens a small menu without taking focus from the editor. */
function Drop({ title, options, fallback, alignRight }: { title: string; options: Option[]; fallback: React.ReactNode; alignRight?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const active = options.find((o) => o.on);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}
        className={`flex h-8 items-center gap-0.5 rounded-md pl-1.5 pr-1 ${open ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text'}`}>
        {active?.icon ?? fallback}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" className={`absolute ${alignRight ? 'right-0' : 'left-0'} top-full z-30 mt-1 min-w-44 rounded-lg border border-line bg-card p-1 shadow-lg`}>
          {options.map((o) => (
            <button key={o.label} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => (o.run(), setOpen(false))}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${o.on ? 'bg-raised font-semibold text-text' : 'text-text hover:bg-raised'}`}>
              <span className="grid w-5 place-items-center text-muted">{o.icon}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      p: e.isActive('paragraph'), h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      b: e.isActive('bold'), i: e.isActive('italic'), u: e.isActive('underline'), hl: e.isActive('highlight'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), tl: e.isActive('taskList'), link: e.isActive('link'),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const c = () => editor.chain().focus();
  const applyLink = () => {
    const url = (linking ?? '').trim();
    if (!url) c().extendMarkRange('link').unsetLink().run();
    else c().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
    setLinking(null);
  };
  if (linking !== null)
    return (
      <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
        <Link2 size={16} className="ml-1 shrink-0 text-muted" />
        <input autoFocus className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none" placeholder="Paste or type a link" value={linking}
          onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? (e.preventDefault(), applyLink()) : e.key === 'Escape' && setLinking(null))} />
        <Btn title="Apply link" onClick={applyLink}><Check size={17} /></Btn>
        <Btn title="Cancel" onClick={() => setLinking(null)}><X size={17} /></Btn>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-[inherit] border-b border-line px-1.5 py-1">
      <Drop
        title="Text style"
        fallback={<Pilcrow size={17} />}
        options={[
          { label: 'Text', icon: <Pilcrow size={17} />, on: s.p, run: () => c().setParagraph().run() },
          { label: 'Heading 1', icon: <Heading1 size={18} />, on: s.h1, run: () => c().toggleHeading({ level: 1 }).run() },
          { label: 'Heading 2', icon: <Heading2 size={18} />, on: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
          { label: 'Heading 3', icon: <Heading3 size={18} />, on: s.h3, run: () => c().toggleHeading({ level: 3 }).run() },
        ]}
      />
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      <Btn title="Bold (Ctrl+B)" on={s.b} onClick={() => c().toggleBold().run()}><Bold size={17} /></Btn>
      <Btn title="Italic (Ctrl+I)" on={s.i} onClick={() => c().toggleItalic().run()}><Italic size={17} /></Btn>
      <Btn title="Underline (Ctrl+U)" on={s.u} onClick={() => c().toggleUnderline().run()}><UnderlineIcon size={17} /></Btn>
      <Btn title="Highlight" on={s.hl} onClick={() => c().toggleHighlight().run()}><Highlighter size={17} /></Btn>
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      <Drop
        title="Lists"
        alignRight
        fallback={<List size={18} />}
        options={[
          { label: 'Bulleted list', icon: <List size={18} />, on: s.ul && !s.tl, run: () => c().toggleBulletList().run() },
          { label: 'Numbered list', icon: <ListOrdered size={18} />, on: s.ol, run: () => c().toggleOrderedList().run() },
          { label: 'Checklist', icon: <ListChecks size={18} />, on: s.tl, run: () => c().toggleTaskList().run() },
        ]}
      />
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      <Btn title="Link" on={s.link} onClick={() => setLinking(editor.getAttributes('link').href ?? '')}><Link2 size={17} /></Btn>
    </div>
  );
}

/** Rich text editor that reads and writes Markdown. */
export function RichEditor({ value, onChange, placeholder, autoFocus, onSubmit, onPasteFiles }: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onPasteFiles?: (files: FileList) => void;
}) {
  const cb = useRef({ onChange, onSubmit, onPasteFiles });
  cb.current = { onChange, onSubmit, onPasteFiles };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      MdUnderline,
      MdHighlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, breaks: true, linkify: true, tightLists: true, transformPastedText: true }),
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'md rich-input', 'data-placeholder': placeholder ?? '' },
      handleKeyDown: (_v, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return cb.current.onSubmit?.(), true;
        return false;
      },
      handlePaste: (_v, e) => {
        if (e.clipboardData?.files.length && cb.current.onPasteFiles) return cb.current.onPasteFiles(e.clipboardData.files), true;
        return false;
      },
    },
    onUpdate: ({ editor: e }) => cb.current.onChange(getMarkdown(e)),
  });
  // Show the placeholder only while empty.
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true });
  useEffect(() => {
    editor?.view.dom.classList.toggle('is-empty', empty);
  }, [editor, empty]);
  if (!editor) return null;
  return (
    <div className="field p-0 focus-within:border-accent">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
