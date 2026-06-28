import * as vscode from 'vscode';
import * as path from 'path';
import { renderMarkdown, RenderContext } from './markdown';

const UPDATE_MS = 32;
const SCROLL_SYNC_MS = 48;
const SELECTION_SYNC_MS = 32;

export class PreviewPanel {
  private static panels = new Map<string, PreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly resource: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private isSyncingFromPreview = false;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private webviewReady = false;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private selectionSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSelectionMs = 0;

  static show(extensionUri: vscode.Uri, resource: vscode.Uri): PreviewPanel {
    const key = resource.toString();
    const existing = PreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }
    return new PreviewPanel(extensionUri, resource);
  }

  private constructor(extensionUri: vscode.Uri, resource: vscode.Uri) {
    this.resource = resource;

    const docDir = vscode.Uri.joinPath(resource, '..');
    const localRoots = [extensionUri, docDir];
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
    if (workspaceFolder) {
      localRoots.push(workspaceFolder.uri);
    }

    this.panel = vscode.window.createWebviewPanel(
      'mdlive.preview',
      `Preview: ${path.basename(resource.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: localRoots,
      }
    );

    PreviewPanel.panels.set(resource.toString(), this);

    this.panel.webview.html = this.getHtml(extensionUri);

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.resource.toString()) {
          this.scheduleUpdate();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (
          e.textEditor.document.uri.toString() === this.resource.toString() &&
          !this.isSyncingFromPreview
        ) {
          this.lastSelectionMs = Date.now();
          this.scheduleSelectionSync(e.textEditor.selection.active.line);
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (
          e.textEditor.document.uri.toString() === this.resource.toString() &&
          !this.isSyncingFromPreview
        ) {
          this.scheduleScrollSync(e.textEditor);
        }
      })
    );
  }

  private scheduleSelectionSync(line: number) {
    if (this.selectionSyncTimer) {
      clearTimeout(this.selectionSyncTimer);
    }
    this.selectionSyncTimer = setTimeout(() => {
      if (!this.isSyncingFromPreview) {
        this.panel.webview.postMessage({ type: 'revealLine', line });
      }
    }, SELECTION_SYNC_MS);
  }

  private scheduleScrollSync(editor: vscode.TextEditor) {
    if (Date.now() - this.lastSelectionMs < 80) {
      return;
    }
    if (this.scrollSyncTimer) {
      clearTimeout(this.scrollSyncTimer);
    }
    this.scrollSyncTimer = setTimeout(() => {
      if (this.isSyncingFromPreview) {
        return;
      }
      const topLine = editor.visibleRanges[0]?.start.line;
      if (topLine !== undefined) {
        this.panel.webview.postMessage({ type: 'scrollToLine', line: topLine });
      }
    }, SCROLL_SYNC_MS);
  }

  private scheduleUpdate() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => this.update(), UPDATE_MS);
  }

  private onMessage(msg: { type: string; line?: number; href?: string; checked?: boolean }) {
    if (msg.type === 'ready') {
      this.webviewReady = true;
      this.update();
      return;
    }

    if (msg.type === 'openLink' && msg.href) {
      this.openLink(msg.href);
      return;
    }

    if (msg.type === 'toggleTask' && msg.line !== undefined && msg.checked !== undefined) {
      this.toggleTask(msg.line, msg.checked);
      return;
    }

    if (msg.line === undefined) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.resource.toString()
    );
    if (!editor) {
      return;
    }

    this.isSyncingFromPreview = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.isSyncingFromPreview = false;
    }, 200);

    const position = new vscode.Position(msg.line, 0);

    if (msg.type === 'revealLine') {
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
      return;
    }

    if (msg.type === 'scrollLine') {
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.AtTop
      );
    }
  }

  private renderContext(): RenderContext {
    return {
      baseUri: this.resource,
      resourceToWebviewUri: (uri) => this.panel.webview.asWebviewUri(uri),
    };
  }

  private openLink(href: string) {
    if (/^https?:/i.test(href)) {
      void vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (href.startsWith('#')) {
      this.panel.webview.postMessage({ type: 'scrollToAnchor', id: href.slice(1) });
      return;
    }
    const target = vscode.Uri.joinPath(this.resource, '..', href);
    void vscode.commands.executeCommand('vscode.open', target);
  }

  private toggleTask(line: number, checked: boolean) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.resource.toString()
    );
    if (!doc) {
      return;
    }
    const lineText = doc.lineAt(line).text;
    const unchecked = /^(\s*(?:[-*+]|\d+\.)\s+)\[ \](\s)/.exec(lineText);
    const checkedMatch = /^(\s*(?:[-*+]|\d+\.)\s+)\[[xX]\](\s)/.exec(lineText);
    let replacement: string | undefined;
    if (checked && unchecked) {
      replacement = `${unchecked[1]}[x]${unchecked[2]}${lineText.slice(unchecked[0].length)}`;
    } else if (!checked && checkedMatch) {
      replacement = `${checkedMatch[1]}[ ]${checkedMatch[2]}${lineText.slice(checkedMatch[0].length)}`;
    }
    if (!replacement) {
      return;
    }
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.resource.toString()
    );
    if (!editor) {
      return;
    }
    this.isSyncingFromPreview = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.isSyncingFromPreview = false;
    }, 200);
    void editor.edit((editBuilder) => {
      editBuilder.replace(new vscode.Range(line, 0, line, lineText.length), replacement!);
    });
  }

  private update() {
    if (!this.webviewReady) {
      return;
    }
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.resource.toString()
    );
    if (!doc) {
      return;
    }

    const html = renderMarkdown(doc.getText(), this.renderContext());
    const activeEditor = vscode.window.activeTextEditor;
    const line =
      activeEditor?.document.uri.toString() === this.resource.toString()
        ? activeEditor.selection.active.line
        : undefined;

    this.panel.webview.postMessage({
      type: 'updateContent',
      html,
      line,
    });
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.resource.toString()
    );
    const initialHtml = doc ? renderMarkdown(doc.getText(), this.renderContext()) : '';
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'preview.css')
    );
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'preview.js')
    );
    const katexCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.css')
    );
    const alertBaseCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it-github-alerts', 'styles', 'github-base.css')
    );
    const alertLightCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it-github-alerts', 'styles', 'github-colors-light.css')
    );
    const alertDarkCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it-github-alerts', 'styles', 'github-colors-dark-media.css')
    );
    const mermaidUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')
    );
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${this.panel.webview.cspSource}`,
      `img-src ${this.panel.webview.cspSource} https: data:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${katexCssUri}">
  <link rel="stylesheet" href="${alertBaseCssUri}">
  <link rel="stylesheet" href="${alertLightCssUri}">
  <link rel="stylesheet" href="${alertDarkCssUri}">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body class="vscode-body">
  <div id="content">${initialHtml}</div>
  <script nonce="${nonce}" src="${mermaidUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    PreviewPanel.panels.delete(this.resource.toString());
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export function openPreview(extensionUri: vscode.Uri) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('Open a markdown file first.');
    return;
  }
  PreviewPanel.show(extensionUri, editor.document.uri);
  vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
}
