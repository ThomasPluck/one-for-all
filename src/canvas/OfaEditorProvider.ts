import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { readConfig } from "../pdk/pdkQuery.js";
import { getPdkCells, getPdkConnectivity } from "../pdk/pdkQuery.js";

export class OfaEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "ofa.schematicEditor";

  private _pdkCellsCache: { name: string }[] | null = null;
  private _pdkConnectivityCache: { name: string }[] | null = null;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new OfaEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      OfaEditorProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const extensionUri = this._context.extensionUri;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    };

    webviewPanel.webview.html = this._getHtml(webviewPanel.webview, extensionUri);

    // Guard to prevent update loops when we edit the document ourselves
    let isApplyingEdit = false;

    // Send document content to webview
    const sendDocumentUpdate = () => {
      if (isApplyingEdit) { return; }
      try {
        const data = JSON.parse(document.getText());
        webviewPanel.webview.postMessage({ type: "update", data });
      } catch {
        // Ignore malformed JSON
      }
    };

    // Listen for webview ready, then send initial data
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          sendDocumentUpdate();
          await this._sendPdkData(webviewPanel.webview);
          break;
        case "edit": {
          isApplyingEdit = true;
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          edit.replace(
            document.uri,
            fullRange,
            JSON.stringify(msg.data, null, 2)
          );
          await vscode.workspace.applyEdit(edit);
          isApplyingEdit = false;
          break;
        }
      }
    });

    // Listen for external document changes
    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendDocumentUpdate();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeListener.dispose();
    });
  }

  private async _sendPdkData(webview: vscode.Webview): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }

    const config = readConfig(root);
    if (!config) { return; }

    try {
      if (!this._pdkCellsCache) {
        this._pdkCellsCache = await getPdkCells(root, config);
      }
      if (!this._pdkConnectivityCache) {
        this._pdkConnectivityCache = await getPdkConnectivity(root, config);
      }
      webview.postMessage({
        type: "pdkData",
        cells: this._pdkCellsCache,
        connectivity: this._pdkConnectivityCache,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(`OFA: Could not load PDK data — ${msg}`);
    }
  }

  private _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "canvas.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "canvasScript.js")
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-group">
      <label for="componentSelect">Components:</label>
      <select id="componentSelect">
        <option value="">Loading...</option>
      </select>
    </div>
    <div class="toolbar-group">
      <label for="junctionSelect">Junctions:</label>
      <select id="junctionSelect">
        <option value="">Loading...</option>
      </select>
    </div>
  </div>
  <div class="canvas-container">
    <canvas id="ofaCanvas"></canvas>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
