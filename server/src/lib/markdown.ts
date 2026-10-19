/** Post bodies are Markdown; this gives the plain text for push notifications and one-line previews. */
export function stripMarkdown(src: string) {
  return src
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|==|\+\+|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\\n/g, '\n');
}
