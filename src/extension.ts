import * as vscode from "vscode";
import { SidebarProvider } from "./SidebarProvider.js";
import { OfaEditorProvider } from "./canvas/OfaEditorProvider.js";

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider
    )
  );

  context.subscriptions.push(
    OfaEditorProvider.register(context)
  );
}

export function deactivate() {}
