import * as vscode from "vscode";
import { SidebarProvider } from "./SidebarProvider.js";

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider
    )
  );
}

export function deactivate() {}
