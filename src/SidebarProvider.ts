import * as vscode from "vscode";
import { EnvironmentStatus } from "./types.js";
import { checkEnvironment, selectAndInitializePdk } from "./environment.js";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ofa.sidebarView";

  private _view?: vscode.WebviewView;
  private _editorMode = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "choosePdk": {
          const success = await selectAndInitializePdk();
          if (success) {
            await this.refresh();
          }
          break;
        }
        case "startEditing":
          this._editorMode = true;
          this._renderEditorMode();
          break;
        case "newSchematic":
          await this._createNewSchematic();
          break;
      }
    });

    this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this._view) {
      return;
    }
    const status = await checkEnvironment();
    const allGood = status.venvExists && status.gdsfactoryInstalled && status.configValid;

    if (allGood && this._editorMode) {
      this._renderEditorMode();
    } else {
      this._view.webview.html = this._getInitHtml(this._view.webview, status);
    }
  }

  private async _renderEditorMode(): Promise<void> {
    if (!this._view) {
      return;
    }
    const ofaFiles = await vscode.workspace.findFiles("**/*.ofa");
    const fileNames = ofaFiles.map((f) => {
      const rel = vscode.workspace.asRelativePath(f);
      return { name: rel, uri: f.toString() };
    });
    this._view.webview.html = this._getEditorHtml(this._view.webview, fileNames);
  }

  private async _createNewSchematic(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Schematic name",
      placeHolder: "my_amplifier",
      validateInput: (v) => {
        if (!v.trim()) { return "Name cannot be empty"; }
        if (!/^[\w\-]+$/.test(v)) { return "Use only letters, numbers, underscores, hyphens"; }
        return undefined;
      },
    });
    if (!name) { return; }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { return; }

    const fileUri = vscode.Uri.joinPath(root, `${name}.ofa`);
    const defaultContent = JSON.stringify(
      { version: 1, components: [], junctions: [], wires: [] },
      null,
      2
    );
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(defaultContent, "utf-8"));
    await vscode.commands.executeCommand("vscode.openWith", fileUri, "ofa.schematicEditor");
    await this._renderEditorMode();
  }

  private _getInitHtml(webview: vscode.Webview, status: EnvironmentStatus): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "sidebar.css")
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "docs", "eyesore_center.png")
    );

    const allGood = status.venvExists && status.gdsfactoryInstalled && status.configValid;

    const checksHtml = `
      <hr width="95%" />
      <h2>Project Requirements</h2>
      <hr width="95%" />
      <ul class="checks">
        <li class="${status.venvExists ? "pass" : "fail"}">
          ${status.venvExists ? "&#10003;" : "&#10007;"} Python Virtual Environment
        </li>
        <li class="${status.gdsfactoryInstalled ? "pass" : "fail"}">
          ${status.gdsfactoryInstalled ? "&#10003;" : "&#10007;"} GDSFactory Installed
        </li>
        <li class="${status.configValid ? "pass" : "fail"}">
          ${status.configValid ? "&#10003;" : "&#10007;"} PDK Configured${status.pdk ? ` (${status.pdk})` : ""}
        </li>
      </ul>
      <hr width="95%" />`;

    const actionHtml = allGood
      ? `<p class="ready">Environment Ready</p>
      <button class="pdk-btn" id="startEditing">Start</button>`
      : `<button class="pdk-btn" id="choosePdk">Choose a PDK</button>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="container">
    <img class="logo" src="${logoUri}" alt="One-For-All" />
    ${checksHtml}
    ${actionHtml}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chooseBtn = document.getElementById("choosePdk");
    if (chooseBtn) {
      chooseBtn.addEventListener("click", () => {
        chooseBtn.disabled = true;
        chooseBtn.textContent = "Initializing...";
        vscode.postMessage({ command: "choosePdk" });
      });
    }
    const startBtn = document.getElementById("startEditing");
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        vscode.postMessage({ command: "startEditing" });
      });
    }
  </script>
</body>
</html>`;
  }

  private _getEditorHtml(
    webview: vscode.Webview,
    files: { name: string; uri: string }[]
  ): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "sidebar.css")
    );

    const fileListHtml = files.length
      ? files
          .map(
            (f) =>
              `<li class="file-item" data-uri="${f.uri}">${f.name}</li>`
          )
          .join("\n")
      : `<li class="placeholder">No schematics yet</li>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="editor-sidebar">
    <section class="panel">
      <button class="panel-header" data-section="hierarchy">
        <span class="chevron">&#9656;</span> Design Hierarchy
      </button>
      <div class="panel-body" id="hierarchy-body">
        <ul class="file-list">
          ${fileListHtml}
        </ul>
        <button class="action-btn" id="newSchematic">+ New Schematic</button>
      </div>
    </section>

    <section class="panel">
      <button class="panel-header" data-section="verification">
        <span class="chevron">&#9656;</span> Verification
      </button>
      <div class="panel-body" id="verification-body">
        <p class="placeholder">Select a schematic to view tests</p>
      </div>
    </section>

    <section class="panel">
      <button class="panel-header" data-section="validation">
        <span class="chevron">&#9656;</span> Validation
      </button>
      <div class="panel-body" id="validation-body">
        <label class="check-item">
          <input type="checkbox" checked /> DRC Checks
        </label>
        <label class="check-item">
          <input type="checkbox" checked /> Collision Detection
        </label>
        <label class="check-item">
          <input type="checkbox" /> PEX Back-Annotation
        </label>
      </div>
    </section>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll(".panel-header").forEach((header) => {
      header.addEventListener("click", () => {
        const panel = header.closest(".panel");
        panel.classList.toggle("collapsed");
        const chevron = header.querySelector(".chevron");
        chevron.textContent = panel.classList.contains("collapsed") ? "\\u25B8" : "\\u25BE";
      });
      // Start expanded — set chevron to down-pointing
      const chevron = header.querySelector(".chevron");
      chevron.textContent = "\\u25BE";
    });

    const newBtn = document.getElementById("newSchematic");
    if (newBtn) {
      newBtn.addEventListener("click", () => {
        vscode.postMessage({ command: "newSchematic" });
      });
    }

    document.querySelectorAll(".file-item").forEach((item) => {
      item.addEventListener("click", () => {
        vscode.postMessage({ command: "openSchematic", uri: item.dataset.uri });
      });
    });
  </script>
</body>
</html>`;
  }
}
