import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
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

export interface RenderContext {
  baseUri?: vscode.Uri;
  resourceToWebviewUri?: (uri: vscode.Uri) => vscode.Uri;
}

function resolveImageSrc(src: string, ctx?: RenderContext): string {
  if (!ctx?.baseUri || /^(https?:|data:)/i.test(src)) {
    return src;
  }
  const localUri = vscode.Uri.joinPath(ctx.baseUri, '..', src);
  if (ctx.resourceToWebviewUri) {
    return ctx.resourceToWebviewUri(localUri).toString();
  }
  return localUri.toString();
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
]);

let md: MarkdownIt | undefined;

function getMarkdownIt(): MarkdownIt {
  if (md) {
    return md;
  }

  md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  strikethroughPlugin(md);

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';
    const openLine = token.map ? token.map[0] : 0;
    const closeLine = token.map ? token.map[1] : undefined;
    return renderCodeBlock(token.content, info, openLine, closeLine);
  };

  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx];
    const openLine = token.map ? token.map[0] : 0;
    return renderCodeBlock(token.content, '', openLine);
  };

  md.renderer.rules.image = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const alt = md!.utils.escapeHtml(token.content);
    const title = token.attrGet('title');
    const line = token.map ? token.map[0] : undefined;
    const resolved = resolveImageSrc(src, env as RenderContext);
    const titleAttr = title ? ` title="${md!.utils.escapeHtml(title)}"` : '';
    const lineAttr = line !== undefined ? ` data-line="${line}"` : '';
    return `<img src="${md!.utils.escapeHtml(resolved)}" alt="${alt}"${titleAttr}${lineAttr}>`;
  };

  for (const rule of BLOCK_RULES) {
    const original = md.renderer.rules[rule];
    md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
      const result = original
        ? original(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
      const token = tokens[idx];
      const line = token.map ? token.map[0] : undefined;
      if (line === undefined) {
        return result;
      }
      return result.replace(/^<(\w+)/, `<$1 data-line="${line}"`);
    };
  }

  return md;
}

export function renderMarkdown(source: string, ctx?: RenderContext): string {
  return getMarkdownIt().render(source, ctx ?? {});
}
