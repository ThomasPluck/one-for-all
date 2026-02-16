import * as vscode from "vscode";
import { PdkCellInfo, PdkConnectivityInfo, PdkLayerInfo } from "../types.js";
import { readConfig, getComponentInfo, exportGds, getPdkAllDataStreaming } from "../pdk/pdkQuery.js";
import { getPdkPackageVersion, readCache, writeCache, clearCache } from "../pdk/pdkCache.js";
import { GdsViewerPanel } from "../GdsViewerPanel.js";

export class OfaEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "ofa.schematicEditor";

  // Static shared cache — all editor instances share one copy
  private static _pdkCellsCache: PdkCellInfo[] | null = null;
  private static _pdkConnectivityCache: PdkConnectivityInfo[] | null = null;
  private static _pdkLayersCache: PdkLayerInfo[] | null = null;

  // Dedup guard — prevents duplicate concurrent loads
  private static _pdkLoadPromise: Promise<void> | null = null;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new OfaEditorProvider(context);

    const editorDisposable = vscode.window.registerCustomEditorProvider(
      OfaEditorProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );

    const refreshCmd = vscode.commands.registerCommand("ofa.refreshPdkCache", async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) { clearCache(root); }
      OfaEditorProvider._pdkCellsCache = null;
      OfaEditorProvider._pdkConnectivityCache = null;
      OfaEditorProvider._pdkLayersCache = null;
      OfaEditorProvider._pdkLoadPromise = null;
      vscode.window.showInformationMessage("OFA: PDK cache cleared. Reopen an .ofa file to re-query.");
    });

    context.subscriptions.push(editorDisposable, refreshCmd);
    return editorDisposable;
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

    // 1. In-memory cache hit — instant
    if (OfaEditorProvider._pdkCellsCache) {
      webview.postMessage({
        type: "pdkData",
        cells: OfaEditorProvider._pdkCellsCache,
        connectivity: OfaEditorProvider._pdkConnectivityCache,
        layers: OfaEditorProvider._pdkLayersCache ?? [],
      });
      return;
    }

    // 2. Another instance is already loading — wait for it, then send from cache
    if (OfaEditorProvider._pdkLoadPromise) {
      await OfaEditorProvider._pdkLoadPromise;
      webview.postMessage({
        type: "pdkData",
        cells: OfaEditorProvider._pdkCellsCache,
        connectivity: OfaEditorProvider._pdkConnectivityCache,
        layers: OfaEditorProvider._pdkLayersCache ?? [],
      });
      return;
    }

    // 3. Cold start — we own the load
    OfaEditorProvider._pdkLoadPromise = this._doLoadPdkData(webview, root, config);
    try {
      await OfaEditorProvider._pdkLoadPromise;
    } finally {
      OfaEditorProvider._pdkLoadPromise = null;
    }
  }

  private async _doLoadPdkData(
    webview: vscode.Webview,
    root: string,
    config: import("../types.js").OfaConfig
  ): Promise<void> {
    // 3a. Try disk cache
    try {
      const version = await getPdkPackageVersion(root, config);
      const cached = readCache(root, config.pythonImport, version);
      if (cached) {
        OfaEditorProvider._pdkCellsCache = cached.cells;
        OfaEditorProvider._pdkConnectivityCache = cached.connectivity;
        OfaEditorProvider._pdkLayersCache = cached.layers;
        webview.postMessage({
          type: "pdkData",
          cells: cached.cells,
          connectivity: cached.connectivity,
          layers: cached.layers,
        });
        return;
      }
    } catch {
      // Version query failed — proceed to live query
    }

    // 3b. Live query — single streaming Python process
    try {
      const cells = await getPdkAllDataStreaming(root, config, (connectivity, layers) => {
        // Fast data callback — send layers + connectivity immediately
        OfaEditorProvider._pdkConnectivityCache = connectivity;
        OfaEditorProvider._pdkLayersCache = layers;
        webview.postMessage({ type: "pdkFastData", connectivity, layers });
      });

      OfaEditorProvider._pdkCellsCache = cells;
      webview.postMessage({ type: "pdkCellData", cells });

      // Write disk cache in background
      try {
        const version = await getPdkPackageVersion(root, config);
        writeCache(root, {
          cacheVersion: 1,
          pdkName: config.pythonImport,
          pdkPackageVersion: version,
          cells,
          connectivity: OfaEditorProvider._pdkConnectivityCache ?? [],
          layers: OfaEditorProvider._pdkLayersCache ?? [],
        });
      } catch {
        // Cache write failed — non-fatal
      }
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
      <button id="btnWireMode" class="toolbar-btn" title="Wire mode (w)" style="font-size: 11px; width: auto; padding: 0 8px;">Wire</button>
      <label for="wireLayerSelect">Layer:</label>
      <select id="wireLayerSelect">
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
