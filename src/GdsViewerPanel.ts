import * as vscode from "vscode";
import * as path from "path";
import { startGdsServer, stopGdsServer } from "./gdsServer.js";

export class GdsViewerPanel {
  private static _panel: vscode.WebviewPanel | null = null;

  public static async show(
    context: vscode.ExtensionContext,
    gdsPath: string
  ): Promise<void> {
    const port = await startGdsServer(gdsPath);
    const fileName = path.basename(gdsPath);

    // Reuse existing panel if open
    if (GdsViewerPanel._panel) {
      GdsViewerPanel._panel.reveal(vscode.ViewColumn.Beside);
      GdsViewerPanel._panel.webview.html = GdsViewerPanel._getHtml(port, fileName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "ofa.gdsViewer",
      `GDS: ${fileName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = GdsViewerPanel._getHtml(port, fileName);

    panel.onDidDispose(() => {
      GdsViewerPanel._panel = null;
      stopGdsServer();
    });

    GdsViewerPanel._panel = panel;
  }

  private static _getHtml(port: number, fileName: string): string {
    const gdsUrl = `http://127.0.0.1:${port}/${encodeURIComponent(fileName)}`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
    iframe { width: 100%; height: 100%; border: none; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #ccc; font-family: sans-serif; font-size: 14px; }
  </style>
</head>
<body>
  <div id="loading" class="loading">Loading GDSJam viewer...</div>
  <iframe id="gds" src="https://gdsjam.com/?embed=true" style="display: none;"></iframe>
  <script>
    const iframe = document.getElementById("gds");
    const loading = document.getElementById("loading");
    const gdsUrl = ${JSON.stringify(gdsUrl)};

    window.addEventListener("message", (ev) => {
      if (!ev.data || !ev.data.type) return;

      if (ev.data.type === "gdsjam:ready") {
        loading.style.display = "none";
        iframe.style.display = "block";
        iframe.contentWindow.postMessage(
          { type: "gdsjam:loadFile", url: gdsUrl },
          "*"
        );
      }

      if (ev.data.type === "gdsjam:fileLoaded") {
        console.log("GDSJam: file loaded", ev.data);
      }

      if (ev.data.type === "gdsjam:error") {
        loading.style.display = "flex";
        loading.textContent = "GDSJam error: " + ev.data.message;
        iframe.style.display = "none";
      }
    });
  </script>
</body>
</html>`;
  }
}
