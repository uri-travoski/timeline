'use dom';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from 'tiptap-markdown';
import markPlugin from 'markdown-it-mark';
import insPlugin from 'markdown-it-ins';
import { Bold, Check, ChevronDown, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, Pilcrow, Underline as UnderlineIcon, X } from 'lucide-react';
import type { DOMProps } from 'expo/dom';

// Runs inside a web view (Expo DOM component) so the phone gets the same editor as the web app.
// It reads and writes the same Markdown: ++underline++, ==highlight==, "- [ ] task".

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

export interface EditorColors {
  card: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  accentText: string;
  raised: string;
}

function Btn({ on, label, onPress, children, colors }: { on?: boolean; label: string; onPress: () => void; children: ReactNode; colors: EditorColors }) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      style={{ width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 7, background: on ? colors.accent : 'transparent', color: on ? '#fff' : colors.text, padding: 0 }}
    >
      {children}
    </button>
  );
}

interface Option { label: string; icon: ReactNode; on: boolean; run: () => void }

/** Toolbar dropdown: shows the active option's icon and opens a small menu without closing the keyboard. */
function Drop({ label, options, fallback, colors, alignRight }: { label: string; options: Option[]; fallback: ReactNode; colors: EditorColors; alignRight?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const active = options.find((o) => o.on);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}
        style={{ height: 38, display: 'flex', alignItems: 'center', gap: 1, padding: '0 4px 0 7px', border: 0, borderRadius: 7, background: open ? colors.raised : 'transparent', color: colors.text }}>
        {active?.icon ?? fallback}
        <ChevronDown size={14} color={colors.muted} />
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', ...(alignRight ? { right: 0 } : { left: 0 }), top: '100%', marginTop: 4, zIndex: 5, minWidth: 190, background: colors.card, border: `1px solid ${colors.line}`, borderRadius: 10, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {options.map((o) => (
            <button key={o.label} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => (o.run(), setOpen(false))}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 10px', border: 0, borderRadius: 7, background: o.on ? colors.raised : 'transparent', color: colors.text, fontSize: 16, fontWeight: o.on ? 700 : 400, textAlign: 'left' }}>
              <span style={{ width: 22, display: 'grid', placeItems: 'center', color: colors.muted }}>{o.icon}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, colors }: { editor: Editor; colors: EditorColors }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      p: e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList') && !e.isActive('taskList'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      b: e.isActive('bold'), i: e.isActive('italic'), u: e.isActive('underline'), hl: e.isActive('highlight'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), tl: e.isActive('taskList'), link: e.isActive('link'),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const c = () => editor.chain().focus();
  const sep = <span style={{ width: 1, height: 22, background: colors.line, flexShrink: 0, margin: '0 3px' }} />;
  const bar = { display: 'flex', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', alignItems: 'center', gap: 2, padding: '4px 6px', borderBottom: `1px solid ${colors.line}`, position: 'sticky', top: 0, background: colors.card, zIndex: 1, borderRadius: '10px 10px 0 0' } as const;
  const applyLink = () => {
    const url = (linking ?? '').trim();
    if (!url) c().extendMarkRange('link').unsetLink().run();
    else c().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
    setLinking(null);
  };
  if (linking !== null)
    return (
      <div style={bar}>
        <Link2 size={18} color={colors.muted} style={{ marginLeft: 6, flexShrink: 0 }} />
        <input
          autoFocus
          inputMode="url"
          value={linking}
          placeholder="Paste or type a link"
          onChange={(e) => setLinking(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyLink())}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: colors.text, fontSize: 16, padding: '8px 6px' }}
        />
        <Btn label="Apply link" onPress={applyLink} colors={colors}><Check size={20} /></Btn>
        <Btn label="Cancel" onPress={() => setLinking(null)} colors={colors}><X size={20} /></Btn>
      </div>
    );
  return (
    <div style={bar}>
      <Drop
        label="Text style"
        fallback={<Pilcrow size={19} />}
        colors={colors}
        options={[
          { label: 'Text', icon: <Pilcrow size={19} />, on: s.p, run: () => c().setParagraph().run() },
          { label: 'Heading 1', icon: <Heading1 size={21} />, on: s.h1, run: () => c().toggleHeading({ level: 1 }).run() },
          { label: 'Heading 2', icon: <Heading2 size={21} />, on: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
          { label: 'Heading 3', icon: <Heading3 size={21} />, on: s.h3, run: () => c().toggleHeading({ level: 3 }).run() },
        ]}
      />
      {sep}
      <Btn label="Bold" on={s.b} onPress={() => c().toggleBold().run()} colors={colors}><Bold size={19} /></Btn>
      <Btn label="Italic" on={s.i} onPress={() => c().toggleItalic().run()} colors={colors}><Italic size={19} /></Btn>
      <Btn label="Underline" on={s.u} onPress={() => c().toggleUnderline().run()} colors={colors}><UnderlineIcon size={19} /></Btn>
      <Btn label="Highlight" on={s.hl} onPress={() => c().toggleHighlight().run()} colors={colors}><Highlighter size={19} /></Btn>
      {sep}
      <Drop
        label="Lists"
        alignRight
        fallback={<List size={20} />}
        colors={colors}
        options={[
          { label: 'Bulleted list', icon: <List size={20} />, on: s.ul, run: () => c().toggleBulletList().run() },
          { label: 'Numbered list', icon: <ListOrdered size={20} />, on: s.ol, run: () => c().toggleOrderedList().run() },
          { label: 'Checklist', icon: <ListChecks size={20} />, on: s.tl, run: () => c().toggleTaskList().run() },
        ]}
      />
      {sep}
      <Btn label="Link" on={s.link} onPress={() => setLinking(editor.getAttributes('link').href ?? '')} colors={colors}><Link2 size={19} /></Btn>
    </div>
  );
}

export default function RichEditor({ initial, placeholder, colors, fontSize, autoFocus, onChange, onHeight }: {
  initial: string;
  placeholder: string;
  colors: EditorColors;
  fontSize: number;
  autoFocus?: boolean;
  onChange: (markdown: string) => Promise<void>;
  onHeight: (px: number) => Promise<void>;
  dom?: DOMProps;
}) {
  const send = useRef(onChange);
  send.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      MdUnderline,
      MdHighlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, breaks: true, linkify: true, tightLists: true, transformPastedText: true }),
    ],
    content: initial,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'md rich-input' } },
    onUpdate: ({ editor: e }) => void send.current(((e.storage as any).markdown.getMarkdown() as string).trim()),
  });
  // The native side sizes the web view to fit, so report our height whenever it changes.
  const box = useRef<HTMLDivElement>(null);
  const sendHeight = useRef(onHeight);
  sendHeight.current = onHeight;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== last) void sendHeight.current((last = h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true });
  useEffect(() => {
    editor?.view.dom.classList.toggle('is-empty', empty);
  }, [editor, empty]);

  const css = `
    html, body { margin: 0; padding: 0; width: 100%; overflow-x: hidden; box-sizing: border-box; background: ${colors.card}; color: ${colors.text}; font-family: system-ui, Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
    .md { font-size: ${fontSize}px; line-height: 1.5; overflow-wrap: anywhere; }
    .md p { margin: 0 0 .5em; }
    .md h1, .md h2, .md h3 { font-weight: 800; line-height: 1.25; margin: .7em 0 .35em; }
    .md h1 { font-size: 1.45em; } .md h2 { font-size: 1.25em; } .md h3 { font-size: 1.1em; }
    .md > :first-child { margin-top: 0; }
    .md ul, .md ol { margin: 0 0 .5em; padding-left: 1.4em; }
    .md li { margin: .15em 0; } .md li > p { margin: 0; }
    .md li::marker { color: ${colors.muted}; }
    .md ul[data-type="taskList"] { list-style: none; padding-left: .2em; }
    .md ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: .5em; }
    .md ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
    .md ul[data-type="taskList"] input { width: 1.1em; height: 1.1em; margin: .25em 0 0; accent-color: ${colors.accent}; }
    .md ul[data-type="taskList"] li[data-checked="true"] > div { color: ${colors.muted}; text-decoration: line-through; }
    .md mark { background: #fde68a; color: #1f2937; border-radius: 3px; padding: 0 .1em; }
    .md a { color: ${colors.accentText}; text-decoration: underline; }
    .md blockquote { border-left: 3px solid ${colors.line}; margin: 0 0 .5em; padding-left: .8em; color: ${colors.muted}; }
    .md code { background: ${colors.raised}; border-radius: 4px; padding: .1em .3em; }
    .rich-input { min-height: 180px; padding: 12px 14px; outline: none; }
    .rich-input.is-empty::before { content: ${JSON.stringify(placeholder)}; color: ${colors.muted}; position: absolute; pointer-events: none; }
    button svg { display: block; }
  `;
  if (!editor) return null;
  return (
    <div ref={box} style={{ border: `1px solid ${colors.line}`, borderRadius: 10, background: colors.card, width: '100%', boxSizing: 'border-box' }}>
      <style>{css}</style>
      <Toolbar editor={editor} colors={colors} />
      <EditorContent editor={editor} />
    </div>
  );
}
