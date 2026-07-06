// extension.ts

import * as vscode from 'vscode';
import { ComparePanel } from './webview/compare-panel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Расширение DBCompare активировано');

    let disposable = vscode.commands.registerCommand('db-compare.start', () => {
        ComparePanel.createOrShow(context.extensionUri, context);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }