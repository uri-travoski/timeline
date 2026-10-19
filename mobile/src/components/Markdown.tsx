import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text as Span, View, type TextStyle } from 'react-native';
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import { Square, SquareCheck } from 'lucide-react-native';
import { Text } from '../text';
import { useTheme } from '../theme';

// Inline spans use plain RN Text ("Span") so they inherit the paragraph's size, which already includes the text-size setting.
// Same Markdown flavour as the web app and the rich editor: ==highlight==, ++underline++, "- [ ] task" lists,
// single line breaks kept, raw HTML ignored.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(mark).use(ins);

interface Node {
  type: string;
  tag: string;
  attrs: Record<string, string>;
  content: string;
  children: Node[];
}

/** "- [ ] thing" / "- [x] thing": record the checked state on the list item and strip the marker. */
function markTasks(n: Node) {
  if (n.type === 'list_item') {
    const first = n.children[0]?.children.find((c) => c.type === 'inline')?.children[0];
    const m = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (m) {
      first!.content = first!.content.slice(m[0].length);
      n.attrs.task = m[1] === ' ' ? 'open' : 'done';
    }
  }
  n.children.forEach(markTasks);
}

/** markdown-it gives a flat token stream; nest it into a tree so it is easy to render. */
function toTree(src: string): Node[] {
  const root: Node = { type: 'root', tag: '', attrs: {}, content: '', children: [] };
  const walk = (tokens: ReturnType<typeof md.parse>, parent: Node) => {
    const stack = [parent];
    for (const tk of tokens) {
      const top = stack[stack.length - 1];
      const node: Node = { type: tk.type.replace(/_(open|close)$/, ''), tag: tk.tag, attrs: Object.fromEntries((tk.attrs ?? []).map(([k, v]) => [k, String(v)])), content: tk.content, children: [] };
      if (tk.nesting === 1) {
        top.children.push(node);
        stack.push(node);
      } else if (tk.nesting === -1) {
        stack.pop();
      } else {
        if (tk.type === 'inline' && tk.children) walk(tk.children, node);
        top.children.push(node);
      }
    }
  };
  walk(md.parse(src, {}), root);
  markTasks(root);
  return root.children;
}

/** A formatted post body. With `maxHeight` the body is cut off and "Show more" calls `onMore`. */
export function Markdown({ source, size = 16, lineHeight = 23, maxHeight, onMore }: { source: string; size?: number; lineHeight?: number; maxHeight?: number; onMore?: () => void }) {
  const t = useTheme();
  const tree = useMemo(() => toTree(source), [source]);
  const [full, setFull] = useState(0);
  const base: TextStyle = { color: t.text, fontSize: size, lineHeight };

  const inline = (nodes: Node[], key = ''): ReactNode[] =>
    nodes.map((n, i) => {
      const k = `${key}${i}`;
      switch (n.type) {
        case 'text':
          return n.content;
        case 'softbreak':
        case 'hardbreak':
          return '\n';
        case 'code_inline':
          return <Span key={k} style={{ fontFamily: 'monospace', backgroundColor: t.raised }}>{n.content}</Span>;
        case 'strong':
          return <Span key={k} style={{ fontWeight: '700' }}>{inline(n.children, k)}</Span>;
        case 'em':
          return <Span key={k} style={{ fontStyle: 'italic' }}>{inline(n.children, k)}</Span>;
        case 'ins':
          return <Span key={k} style={{ textDecorationLine: 'underline' }}>{inline(n.children, k)}</Span>;
        case 's':
          return <Span key={k} style={{ textDecorationLine: 'line-through' }}>{inline(n.children, k)}</Span>;
        case 'mark':
          return <Span key={k} style={{ backgroundColor: '#fde68a', color: '#1f2937' }}>{inline(n.children, k)}</Span>;
        case 'link':
          return (
            <Span key={k} style={{ color: t.accentText, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(n.attrs.href).catch(() => {})}>
              {inline(n.children, k)}
            </Span>
          );
        default:
          return n.children.length ? inline(n.children, k) : n.content;
      }
    });

  const inlineOf = (n: Node) => inline(n.children.find((c) => c.type === 'inline')?.children ?? []);

  const block = (nodes: Node[], depth = 0): ReactNode[] =>
    nodes.map((n, i) => {
      const last = i === nodes.length - 1;
      const gap = last ? 0 : 8;
      switch (n.type) {
        case 'paragraph':
          return <Text key={i} style={[base, { marginBottom: gap }]}>{inlineOf(n)}</Text>;
        case 'heading': {
          const h = { h1: [1.45, 1.3], h2: [1.25, 1.3], h3: [1.1, 1.35] }[n.tag] ?? [1.1, 1.35];
          return <Text key={i} style={[base, { fontWeight: '800', fontSize: size * h[0], lineHeight: size * h[0] * h[1], marginTop: i ? 6 : 0, marginBottom: last ? 0 : 6 }]}>{inlineOf(n)}</Text>;
        }
        case 'bullet_list':
        case 'ordered_list': {
          let num = Number(n.attrs.start ?? 1);
          return (
            <View key={i} style={{ marginBottom: depth ? 0 : gap, gap: 4 }}>
              {n.children.map((item, j) => {
                const task = item.attrs.task ? item.attrs.task === 'done' : null;
                const marker =
                  task !== null ? (
                    task ? <SquareCheck size={size + 2} color={t.accent} /> : <Square size={size + 2} color={t.muted} />
                  ) : (
                    <Text style={[base, { color: t.muted }]}>{n.type === 'ordered_list' ? `${num++}.` : depth % 2 ? '◦' : '•'}</Text>
                  );
                return (
                  <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ minWidth: n.type === 'ordered_list' ? size * 1.3 : size * 0.8, alignItems: 'flex-end', paddingTop: task !== null ? (lineHeight - size - 2) / 2 : 0 }}>{marker}</View>
                    <View style={{ flex: 1, opacity: task ? 0.6 : 1 }}>{block(item.children, depth + 1)}</View>
                  </View>
                );
              })}
            </View>
          );
        }
        case 'blockquote':
          return (
            <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: t.line, paddingLeft: 10, marginBottom: gap }}>
              {block(n.children, depth)}
            </View>
          );
        case 'fence':
        case 'code_block':
          return (
            <View key={i} style={{ backgroundColor: t.raised, borderRadius: 6, padding: 10, marginBottom: gap }}>
              <Text style={{ fontFamily: 'monospace', color: t.text, fontSize: size - 2 }}>{n.content.replace(/\n$/, '')}</Text>
            </View>
          );
        case 'hr':
          return <View key={i} style={{ height: 1, backgroundColor: t.line, marginVertical: 8 }} />;
        case 'inline':
          return <Text key={i} style={base}>{inline(n.children)}</Text>;
        default:
          return null;
      }
    });

  const cut = !!maxHeight && full > maxHeight;
  return (
    <View>
      <View style={maxHeight ? { maxHeight, overflow: 'hidden' } : undefined}>
        <View onLayout={(e) => setFull(e.nativeEvent.layout.height)}>{block(tree)}</View>
      </View>
      {cut && (
        <Pressable onPress={onMore} hitSlop={8}>
          <Text style={{ color: t.accentText, fontWeight: '600', fontSize: size - 2, marginTop: 4 }}>Show more</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Plain-text version for one-line previews. */
export function stripMarkdown(src: string) {
  return src
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|==|\+\+|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\\n/g, '\n');
}
