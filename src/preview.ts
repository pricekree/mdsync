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

    this.panel = vscode.window.createWebviewPanel(
      'mdsync.preview',
      `Preview: ${path.basename(resource.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
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

  private onMessage(msg: { type: string; line?: number }) {
    if (msg.type === 'ready') {
      this.webviewReady = true;
      this.update();
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
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${this.panel.webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body class="vscode-body">
  <div id="content">${initialHtml}</div>
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
