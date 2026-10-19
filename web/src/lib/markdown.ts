import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import taskLists from 'markdown-it-task-lists';

/**
 * Post bodies are Markdown. Besides the usual syntax we use ==highlight==, ++underline++ and "- [ ] task" lists,
 * matching what the rich editor writes. Raw HTML is never rendered, and single line breaks are kept.
 */
export const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })
  .use(mark)
  .use(ins)
  .use(taskLists, { enabled: false });

const defaultLink = md.renderer.rules.link_open ?? ((tokens, i, opts, _env, self) => self.renderToken(tokens, i, opts));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noreferrer noopener');
  return defaultLink(tokens, i, opts, env, self);
};

export const renderMarkdown = (src: string) => md.render(src);

/** Plain-text version for one-line previews (notifications, reminders, search results). */
export function stripMarkdown(src: string) {
  return src
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|==|\+\+|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\\n/g, '\n');
}
