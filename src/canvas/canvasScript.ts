// Entry point — wires up all modules and starts the canvas editor.
// This script runs inside the webview (browser context, no Node APIs).

import { canvas, vscode } from "./state";
import { resizeCanvas, render } from "./rendering";
import { initToolbar, initEventListeners } from "./input";
import { initMessageHandler } from "./messages";

// Resize observer
const resizeObserver = new ResizeObserver(() => resizeCanvas());
resizeObserver.observe(canvas.parentElement!);
resizeCanvas();

// Start render loop
requestAnimationFrame(render);

// Wire up toolbar buttons and input events
initToolbar();
initEventListeners();

// Wire up extension ↔ webview message handling
initMessageHandler();

// Notify extension that webview is ready
vscode.postMessage({ type: "ready" });
