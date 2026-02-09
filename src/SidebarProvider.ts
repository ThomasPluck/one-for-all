import * as vscode from "vscode";
import { EnvironmentStatus } from "./types.js";
import { checkEnvironment, selectAndInitializePdk } from "./environment.js";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ofa.sidebarView";

  private _view?: vscode.WebviewView;

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
      if (msg.command === "choosePdk") {
        const success = await selectAndInitializePdk();
        if (success) {
          await this.refresh();
        }
      }
    });

    this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this._view) {
      return;
    }
    const status = await checkEnvironment();
    this._view.webview.html = this._getHtml(this._view.webview, status);
  }

  private _getHtml(webview: vscode.Webview, status: EnvironmentStatus): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "sidebar.css")
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "docs", "eyesore_logo.png")
    );

    const allGood = status.venvExists && status.gdsfactoryInstalled && status.configValid;

    const checksHtml = `
      <ul class="checks">
        <li class="${status.venvExists ? "pass" : "fail"}">
          ${status.venvExists ? "&#10003;" : "&#10007;"} Python virtual environment
        </li>
        <li class="${status.gdsfactoryInstalled ? "pass" : "fail"}">
          ${status.gdsfactoryInstalled ? "&#10003;" : "&#10007;"} gdsfactory installed
        </li>
        <li class="${status.configValid ? "pass" : "fail"}">
          ${status.configValid ? "&#10003;" : "&#10007;"} PDK configured${status.pdk ? ` (${status.pdk})` : ""}
        </li>
      </ul>`;

    const actionHtml = allGood
      ? `<p class="ready">Environment ready</p>`
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
    const btn = document.getElementById("choosePdk");
    if (btn) {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Initializing...";
        vscode.postMessage({ command: "choosePdk" });
      });
    }
  </script>
</body>
</html>`;
  }
}
