import * as vscode from 'vscode';
import { openPreview } from './preview';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mdsync.openPreview', () => {
      openPreview(context.extensionUri);
    })
  );
}

export function deactivate() {}
