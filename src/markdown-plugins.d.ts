declare module 'markdown-it-anchor';
declare module 'markdown-it-footnote';
declare module 'markdown-it-mark';
declare module 'markdown-it-deflist';
declare module 'markdown-it-sub';
declare module 'markdown-it-sup';
declare module 'markdown-it-emoji';
declare module 'markdown-it-github-alerts' {
  import MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export default plugin;
}

declare module '@mdit/plugin-katex' {
  import MarkdownIt from 'markdown-it';
  export function katex(md: MarkdownIt, options?: Record<string, unknown>): void;
}
