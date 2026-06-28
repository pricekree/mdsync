import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import deflist from 'markdown-it-deflist';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import { full as emoji } from 'markdown-it-emoji';
import githubAlerts from 'markdown-it-github-alerts';
import { katex } from '@mdit/plugin-katex';
import DOMPurify from 'isomorphic-dompurify';
import type { Config as DOMPurifyConfig } from 'dompurify';
import hljs from 'highlight.js/lib/core';
import * as vscode from 'vscode';

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  jsonc: 'json',
};

const loadedLangs = new Set<string>();

function ensureLanguage(lang: string): string | undefined {
  const id = ALIASES[lang] || lang;
  if (hljs.getLanguage(id)) {
    return id;
  }
  if (loadedLangs.has(id)) {
    return undefined;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(`highlight.js/lib/languages/${id}`);
    hljs.registerLanguage(id, mod);
    loadedLangs.add(id);
    return id;
  } catch {
    loadedLangs.add(id);
    return undefined;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightLine(line: string, langId: string | undefined): string {
  if (langId) {
    try {
      return hljs.highlight(line, { language: langId }).value;
    } catch {
      // fall through
    }
  }
  return escapeHtml(line);
}

function normalizeLines(content: string): string[] {
  let lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

const COPY_BTN = `<button class="code-copy-btn" type="button" title="Copy code" aria-label="Copy code"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.75.75h6.5c.69 0 1.25.56 1.25 1.25v6.5a1.25 1.25 0 0 1-1.25 1.25h-6.5A1.25 1.25 0 0 1 4.5 8.5v-6.5C4.5 1.31 5.06.75 5.75.75zm-4 4.5h1.25a.75.75 0 0 1 0 1.5H1.75v7.5c0 .69.56 1.25 1.25 1.25h7.5a.75.75 0 0 1 0 1.5h-7.5A2.75 2.75 0 0 1 0 13.75V5.25z"/></svg><span class="code-copy-label">Copy</span></button>`;

function renderMermaidBlock(content: string, openLine: number, closeLine?: number): string {
  const lineAttr = ` data-line="${openLine}"`;
  let html = `<pre class="mermaid"${lineAttr}>${escapeHtml(content.trimEnd())}</pre>`;
  if (closeLine !== undefined && closeLine > openLine) {
    html += `<span class="fence-close" data-line="${closeLine}" aria-hidden="true"></span>`;
  }
  return html;
}

function renderCodeBlock(
  content: string,
  lang: string,
  openLine: number,
  closeLine?: number
): string {
  const langId = lang ? ensureLanguage(lang.toLowerCase().split(/\s+/)[0]) : undefined;
  const langClass = langId ? ` class="language-${langId}"` : '';
  const langAttr = langId ? ` data-lang="${langId}"` : '';
  const lines = normalizeLines(content);
  const spans = lines
    .map((line, i) => {
      const lineNum = openLine + 1 + i;
      const inner = line.length === 0 ? '&#8203;' : highlightLine(line, langId);
      return `<span class="code-line" data-line="${lineNum}">${inner}</span>`;
    })
    .join('');

  const langLabel = langId ? `<span class="code-lang">${langId}</span>` : '<span class="code-lang"></span>';
  const header = `<div class="code-block-header">${langLabel}${COPY_BTN}</div>`;

  let html = `<pre data-line="${openLine}"${langAttr}>${header}<code${langClass}>${spans}`;
  if (closeLine !== undefined && closeLine > openLine + lines.length) {
    html += `<span class="code-line fence-close" data-line="${closeLine}" aria-hidden="true"></span>`;
  }
  html += '</code></pre>';
  return html;
}

function strikethroughPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'strikethrough', (state, silent) => {
    const max = state.posMax;
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7e) {
      return false;
    }
    if (start + 1 >= max || state.src.charCodeAt(start + 1) !== 0x7e) {
      return false;
    }

    let pos = start + 2;
    while (pos < max - 1) {
      if (state.src.charCodeAt(pos) === 0x7e && state.src.charCodeAt(pos + 1) === 0x7e) {
        break;
      }
      pos++;
    }
    if (pos >= max - 1) {
      return false;
    }
    if (silent) {
      return true;
    }

    const tokenO = state.push('s_open', 's', 1);
    tokenO.markup = '~~';
    const tokenT = state.push('text', '', 0);
    tokenT.content = state.src.slice(start + 2, pos);
    const tokenC = state.push('s_close', 's', -1);
    tokenC.markup = '~~';
    state.pos = pos + 2;
    return true;
  });
}

function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const start = state.pos;
    if (start + 3 >= state.posMax || state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b) {
      return false;
    }

    const close = state.src.indexOf(']]', start + 2);
    if (close === -1) {
      return false;
    }

    const inner = state.src.slice(start + 2, close);
    const pipe = inner.indexOf('|');
    const page = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const label = (pipe === -1 ? page : inner.slice(pipe + 1)).trim();
    if (!page) {
      return false;
    }
    if (silent) {
      return true;
    }

    const href = page.includes('/') || page.includes('.') ? page : `${page}.md`;
    const tokenO = state.push('link_open', 'a', 1);
    tokenO.attrs = [['href', href]];
    const tokenT = state.push('text', '', 0);
    tokenT.content = label || page;
    state.push('link_close', 'a', -1);
    state.pos = close + 2;
    return true;
  });
}

export interface RenderContext {
  baseUri?: vscode.Uri;
  resourceToWebviewUri?: (uri: vscode.Uri) => vscode.Uri;
  lineOffset?: number;
}

function resolveResourceUri(src: string, ctx?: RenderContext): string {
  if (!src || /^(https?:|data:|vscode-webview:|vscode-resource:)/i.test(src)) {
    return src;
  }
  if (!ctx?.baseUri) {
    return src;
  }

  const docDir = vscode.Uri.joinPath(ctx.baseUri, '..');
  const normalized = src.replace(/^\.\//, '');
  const localUri = src.startsWith('/')
    ? vscode.Uri.file(src)
    : vscode.Uri.joinPath(docDir, ...normalized.split('/'));

  if (ctx.resourceToWebviewUri) {
    return ctx.resourceToWebviewUri(localUri).toString();
  }
  return localUri.toString();
}

function rewriteResourceUrls(html: string, ctx?: RenderContext): string {
  if (!ctx?.baseUri || !ctx.resourceToWebviewUri) {
    return html;
  }

  return html.replace(/(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi, (_match, prefix, quote, src) => {
    return `${prefix}${quote}${resolveResourceUri(src, ctx)}${quote}`;
  });
}

function lineForToken(token: { map?: [number, number] | null }, offset: number): number | undefined {
  if (!token.map) {
    return undefined;
  }
  return token.map[0] + offset;
}

const BLOCK_RULES = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'table_open',
  'thead_open',
  'tbody_open',
  'tr_open',
  'hr',
  'footnote_block_open',
]);

const SANITIZE_OPTIONS: DOMPurifyConfig = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_ATTR: [
    'data-line',
    'data-lang',
    'data-processed',
    'aria-hidden',
    'xmlns',
    'encoding',
    'display',
    'viewBox',
    'fill',
    'd',
    'fill-rule',
    'clip-rule',
    'width',
    'height',
    'version',
    'class',
    'style',
    'id',
    'href',
    'type',
    'checked',
    'disabled',
    'title',
    'alt',
    'src',
    'valign',
    'align',
    'tabindex',
  ],
};

let md: MarkdownIt | undefined;

function getMarkdownIt(): MarkdownIt {
  if (md) {
    return md;
  }

  md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
  md.use(anchor, {
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '',
      placement: 'before',
      class: 'header-anchor',
    }),
  });
  md.use(footnote);
  md.use(mark);
  md.use(deflist);
  md.use(sub);
  md.use(sup);
  md.use(emoji);
  md.use(githubAlerts);
  md.use(katex, { throwOnError: false });
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  strikethroughPlugin(md);
  wikilinkPlugin(md);

  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';
    const lang = info.toLowerCase().split(/\s+/)[0];
    const offset = (env as RenderContext).lineOffset ?? 0;
    const openLine = lineForToken(token, offset) ?? 0;
    const closeLine = token.map ? token.map[1] + offset : undefined;
    if (lang === 'mermaid') {
      return renderMermaidBlock(token.content, openLine, closeLine);
    }
    return renderCodeBlock(token.content, info, openLine, closeLine);
  };

  md.renderer.rules.code_block = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const offset = (env as RenderContext).lineOffset ?? 0;
    const openLine = lineForToken(token, offset) ?? 0;
    return renderCodeBlock(token.content, '', openLine);
  };

  md.renderer.rules.image = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const alt = md!.utils.escapeHtml(token.content);
    const title = token.attrGet('title');
    const offset = (env as RenderContext).lineOffset ?? 0;
    const line = lineForToken(token, offset);
    const resolved = resolveResourceUri(src, env as RenderContext);
    const titleAttr = title ? ` title="${md!.utils.escapeHtml(title)}"` : '';
    const lineAttr = line !== undefined ? ` data-line="${line}"` : '';
    return `<img src="${md!.utils.escapeHtml(resolved)}" alt="${alt}"${titleAttr}${lineAttr}>`;
  };

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') || '';
    if (href.startsWith('#')) {
      token.attrSet('class', 'internal-link');
    }
    return self.renderToken(tokens, idx, options);
  };

  for (const rule of BLOCK_RULES) {
    const original = md.renderer.rules[rule];
    md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
      const result = original
        ? original(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
      const token = tokens[idx];
      const offset = (env as RenderContext).lineOffset ?? 0;
      const line = lineForToken(token, offset);
      if (line === undefined) {
        return result;
      }
      return result.replace(/^<(\w+)/, `<$1 data-line="${line}"`);
    };
  }

  return md;
}

interface FrontMatterInfo {
  body: string;
  html: string;
  lineCount: number;
}

function parseFrontMatter(source: string): FrontMatterInfo {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: source, html: '', lineCount: 0 };
  }

  const block = match[0];
  const lines = block.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const lineCount = lines.length;
  const rows = lines
    .map((line, i) => `<div class="front-matter-line" data-line="${i}">${escapeHtml(line)}</div>`)
    .join('');
  const html = `<section class="front-matter" data-line="0" aria-label="Front matter">${rows}</section>`;

  return {
    body: source.slice(block.length),
    html,
    lineCount,
  };
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_OPTIONS) as string;
}

export function renderMarkdown(source: string, ctx?: RenderContext): string {
  const fm = parseFrontMatter(source);
  const env: RenderContext = { ...ctx, lineOffset: fm.lineCount };
  const bodyHtml = getMarkdownIt().render(fm.body, env);
  const combined = fm.html + bodyHtml;
  return sanitizeHtml(rewriteResourceUrls(combined, env));
}
