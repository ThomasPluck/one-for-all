import * as vscode from "vscode";
import { PdkCellInfo, PdkConnectivityInfo } from "../types.js";
import { readConfig, getPdkCells, getPdkConnectivity, getComponentInfo, exportGds } from "../pdk/pdkQuery.js";
import { GdsViewerPanel } from "../GdsViewerPanel.js";

export class OfaEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "ofa.schematicEditor";

  private _pdkCellsCache: PdkCellInfo[] | null = null;
  private _pdkConnectivityCache: PdkConnectivityInfo[] | null = null;

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
        case "queryComponentInfo": {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) {
            webviewPanel.webview.postMessage({ type: "componentInfoResult", componentId: msg.componentId, error: "No workspace folder" });
            break;
          }
          const config = readConfig(root);
          if (!config) {
            webviewPanel.webview.postMessage({ type: "componentInfoResult", componentId: msg.componentId, error: "No OFA config" });
            break;
          }
          try {
            const result = await getComponentInfo(root, config, msg.cellName, msg.params);
            webviewPanel.webview.postMessage({
              type: "componentInfoResult",
              componentId: msg.componentId,
              xsize: result.xsize,
              ysize: result.ysize,
              ports: result.ports,
            });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            webviewPanel.webview.postMessage({
              type: "componentInfoResult",
              componentId: msg.componentId,
              error: errMsg,
            });
          }
          break;
        }
        case "exportGds": {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) {
            webviewPanel.webview.postMessage({ type: "exportGdsResult", error: "No workspace folder" });
            break;
          }
          const config = readConfig(root);
          if (!config) {
            webviewPanel.webview.postMessage({ type: "exportGdsResult", error: "No OFA config" });
            break;
          }
          try {
            await document.save();
            const gdsPath = await exportGds(root, config, document.uri.fsPath);
            webviewPanel.webview.postMessage({ type: "exportGdsResult", path: gdsPath });
            vscode.window.showInformationMessage(`GDS exported: ${gdsPath}`);
            GdsViewerPanel.show(this._context, gdsPath);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            webviewPanel.webview.postMessage({ type: "exportGdsResult", error: errMsg });
            vscode.window.showErrorMessage(`GDS export failed: ${errMsg}`);
          }
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
    <div class="toolbar-group toolbar-actions" id="selectionToolbar" style="display: none;">
      <span class="toolbar-separator"></span>
      <button id="btnRotate" class="toolbar-btn" title="Rotate 90° (r)">&#x21BB;</button>
      <button id="btnFlipH" class="toolbar-btn" title="Flip horizontal (h)">&#x2194;</button>
      <button id="btnFlipV" class="toolbar-btn" title="Flip vertical (v)">&#x2195;</button>
    </div>
    <div class="toolbar-group" style="margin-left: auto;">
      <button id="btnExportGds" class="toolbar-btn" title="Export GDS" style="font-size: 11px; width: auto; padding: 0 8px;">Export GDS</button>
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
