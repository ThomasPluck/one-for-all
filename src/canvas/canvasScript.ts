// This script runs inside the webview (browser context, no Node APIs).

// --- Types ---

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface PdkPortInfo {
  name: string;
  x: number;
  y: number;
  layer: [number, number] | null;
  width: number;
}

interface PdkCellInfo {
  name: string;
  params: Record<string, unknown>;
  ports: PdkPortInfo[];
  xsize: number;
  ysize: number;
}

interface OfaComponent {
  id: string;
  cell: string;
  x: number;
  y: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  params: Record<string, number | string | boolean>;
  _cache?: { xsize: number; ysize: number; ports: PdkPortInfo[] };
}

interface DocumentData {
  version: number;
  components: OfaComponent[];
  junctions: unknown[];
  wires: unknown[];
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// --- Layer color map ---

const LAYER_COLORS: Record<string, string> = {
  "Metal1": "#4caf50",
  "Metal2": "#2196f3",
  "Metal3": "#ff9800",
  "Metal4": "#9c27b0",
  "Metal5": "#f44336",
  "TopMetal1": "#00bcd4",
  "TopMetal2": "#ffeb3b",
  "Poly": "#e91e63",
  "Active": "#8bc34a",
};

// GDS layer number → name mapping (IHP SG13G2 common layers)
const GDS_LAYER_NAMES: Record<number, string> = {
  1: "Active",
  5: "Poly",
  8: "Metal1",
  10: "Metal2",
  30: "Metal3",
  50: "Metal4",
  67: "Metal5",
  126: "TopMetal1",
  134: "TopMetal2",
};

function layerColor(layer: [number, number] | null): string {
  if (!layer) { return "#888"; }
  const name = GDS_LAYER_NAMES[layer[0]];
  if (name && LAYER_COLORS[name]) { return LAYER_COLORS[name]; }
  return "#888";
}

function layerName(layer: [number, number] | null): string {
  if (!layer) { return "Unknown"; }
  return GDS_LAYER_NAMES[layer[0]] || `Layer ${layer[0]}`;
}

// --- State ---

const vscode = acquireVsCodeApi();

const canvas = document.getElementById("ofaCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const componentSelect = document.getElementById("componentSelect") as HTMLSelectElement;
const junctionSelect = document.getElementById("junctionSelect") as HTMLSelectElement;
const selectionToolbar = document.getElementById("selectionToolbar") as HTMLDivElement;
const btnRotate = document.getElementById("btnRotate") as HTMLButtonElement;
const btnFlipH = document.getElementById("btnFlipH") as HTMLButtonElement;
const btnFlipV = document.getElementById("btnFlipV") as HTMLButtonElement;
const btnExportGds = document.getElementById("btnExportGds") as HTMLButtonElement;

// Default zoom 200x so sub-micron devices (e.g. 0.42 x 0.15 um) are visible
const camera: Camera = { x: 0, y: 0, zoom: 200 };
let spaceHeld = false;
let isPanning = false;
let middlePanning = false;
let panStart = { x: 0, y: 0 };
let documentData: DocumentData | null = null;
let pdkCells: PdkCellInfo[] = [];

// --- Selection & interaction state ---
let selectedComponentId: string | null = null;
let isDragging = false;
let dragStartWorld = { x: 0, y: 0 };
let dragOrigPos = { x: 0, y: 0 };

// Runtime cache for per-component sizes (from re-queries after param edits)
const componentSizeCache = new Map<string, { xsize: number; ysize: number; ports: PdkPortInfo[] }>();
const pendingQueries = new Set<string>();

// --- Helpers ---

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function getCellInfo(cellName: string): PdkCellInfo | undefined {
  return pdkCells.find((c) => c.name === cellName);
}

function getDeviceSize(comp: OfaComponent): { w: number; h: number } {
  // 1. Per-component cache (from re-query after param edit)
  const cached = componentSizeCache.get(comp.id);
  if (cached) {
    return { w: Math.max(cached.xsize, 0.05), h: Math.max(cached.ysize, 0.05) };
  }
  // 2. PDK cell defaults (from bulk query)
  const info = getCellInfo(comp.cell);
  if (info) {
    return { w: Math.max(info.xsize, 0.05), h: Math.max(info.ysize, 0.05) };
  }
  // 3. Ultimate fallback
  return { w: 1, h: 1 };
}

function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.left - camera.x) / camera.zoom,
    y: (sy - rect.top - camera.y) / camera.zoom,
  };
}

function getSelectedComponent(): OfaComponent | null {
  if (!documentData || !selectedComponentId) { return null; }
  return documentData.components.find((c) => c.id === selectedComponentId) ?? null;
}

function updateHoverCursor(worldX: number, worldY: number): void {
  if (spaceHeld) { return; }
  const comp = hitTestComponent(worldX, worldY);
  if (comp) {
    canvas.style.cursor = comp.id === selectedComponentId ? "move" : "pointer";
    return;
  }
  canvas.style.cursor = "default";
}

// --- Resize ---

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const resizeObserver = new ResizeObserver(() => resizeCanvas());
resizeObserver.observe(canvas.parentElement!);
resizeCanvas();

// --- Grid ---

function drawGrid(w: number, h: number): void {
  // Adaptive grid: pick a grid spacing so lines are ~20-100px apart on screen
  const minScreenSpacing = 20;
  const idealScreenSpacing = 50;
  // Find a "nice" world-space grid size
  const rawSpacing = idealScreenSpacing / camera.zoom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawSpacing)));
  const candidates = [magnitude * 0.1, magnitude * 0.5, magnitude, magnitude * 5, magnitude * 10];
  let gridSize = candidates[0];
  for (const c of candidates) {
    if (c * camera.zoom >= minScreenSpacing) {
      gridSize = c;
      break;
    }
  }
  const majorSize = gridSize * 5;

  ctx.save();
  ctx.lineWidth = 1 / camera.zoom;

  const left = -camera.x / camera.zoom;
  const top = -camera.y / camera.zoom;
  const right = left + w / camera.zoom;
  const bottom = top + h / camera.zoom;

  // Minor grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;

  ctx.beginPath();
  for (let x = startX; x <= right; x += gridSize) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = startY; y <= bottom; y += gridSize) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();

  // Major grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  const majorStartX = Math.floor(left / majorSize) * majorSize;
  const majorStartY = Math.floor(top / majorSize) * majorSize;

  ctx.beginPath();
  for (let x = majorStartX; x <= right; x += majorSize) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = majorStartY; y <= bottom; y += majorSize) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Origin crosshair ---

function drawOrigin(): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 100, 100, 0.3)";
  ctx.lineWidth = 1 / camera.zoom;
  const size = 30 / camera.zoom;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size, 0);
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

// --- Component transform helper ---

function applyComponentTransform(comp: OfaComponent, w: number, h: number): void {
  if (comp.rotation) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate((comp.rotation * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
  }
  if (comp.flipH) {
    ctx.translate(w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-w / 2, 0);
  }
  if (comp.flipV) {
    ctx.translate(0, h / 2);
    ctx.scale(1, -1);
    ctx.translate(0, -h / 2);
  }
}

// --- Device rendering ---

function fitText(text: string, maxW: number, maxH: number, maxFontSize: number): number {
  // Binary search for the largest font size that fits within maxW x maxH
  let lo = 0;
  let hi = maxFontSize;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    ctx.font = `${mid}px sans-serif`;
    const m = ctx.measureText(text);
    if (m.width <= maxW && mid <= maxH) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function drawComponents(): void {
  if (!documentData) { return; }

  for (const comp of documentData.components) {
    const { w, h } = getDeviceSize(comp);
    const info = getCellInfo(comp.cell);

    ctx.save();
    ctx.translate(comp.x, comp.y);
    applyComponentTransform(comp, w, h);

    // Device rectangle
    ctx.fillStyle = "rgba(60, 120, 180, 0.25)";
    ctx.strokeStyle = "rgba(100, 180, 255, 0.7)";
    ctx.lineWidth = 1 / camera.zoom;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0, 0, w, h);

    // Device labels — two lines: cell name (top) and ID (bottom), scaled to fit
    const padX = w * 0.1;
    const padY = h * 0.1;
    const availW = w - padX * 2;
    const availH = (h - padY * 2) / 2; // half height for each line

    const shortId = comp.id.substring(0, 6);
    const cellFontSize = fitText(comp.cell, availW, availH * 0.9, h * 0.4);
    const idFontSize = fitText(shortId, availW, availH * 0.9, h * 0.3);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(220, 230, 255, 0.9)";

    // Cell name — upper half
    ctx.font = `bold ${cellFontSize}px sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText(comp.cell, w / 2, h / 2);

    // ID — lower half
    ctx.font = `${idFontSize}px sans-serif`;
    ctx.fillStyle = "rgba(180, 200, 230, 0.7)";
    ctx.textBaseline = "top";
    ctx.fillText(shortId, w / 2, h / 2);

    // Ports (use per-component cache if available, otherwise PDK defaults)
    const cachedSize = componentSizeCache.get(comp.id);
    const ports = cachedSize ? cachedSize.ports : (info ? info.ports : []);
    if (ports.length > 0) {
      const portSize = Math.max(0.3, Math.min(w, h) * 0.08);
      for (const port of ports) {
        const color = layerColor(port.layer);
        ctx.fillStyle = color;
        ctx.fillRect(
          port.x - portSize / 2,
          port.y - portSize / 2,
          portSize,
          portSize
        );
        // Port label
        const pFontSize = Math.max(0.8, portSize * 1.5);
        ctx.font = `${pFontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(port.name, port.x + portSize, port.y - portSize / 2);
      }
    }

    ctx.restore();
  }
}

// --- Selection rendering ---

function drawSelection(): void {
  const comp = getSelectedComponent();
  if (!comp) { return; }
  const { w, h } = getDeviceSize(comp);

  // Dashed selection border (in component-local space with transforms)
  ctx.save();
  ctx.translate(comp.x, comp.y);
  applyComponentTransform(comp, w, h);

  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 2 / camera.zoom;
  ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
  ctx.strokeRect(0, 0, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// --- Legend (screen-space) ---

function drawLegend(w: number, _h: number): void {
  const entries = Object.entries(LAYER_COLORS);
  const lineHeight = 16;
  const padding = 8;
  const circleR = 5;
  const legendW = 120;
  const legendH = entries.length * lineHeight + padding * 2;

  const x = w - legendW - 12;
  const y = 12;

  // Background
  ctx.fillStyle = "rgba(30, 30, 30, 0.75)";
  ctx.beginPath();
  ctx.roundRect(x, y, legendW, legendH, 4);
  ctx.fill();

  // Entries
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "11px sans-serif";

  for (let i = 0; i < entries.length; i++) {
    const [name, color] = entries[i];
    const ey = y + padding + i * lineHeight + lineHeight / 2;

    // Colored circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + padding + circleR, ey, circleR, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = "#ccc";
    ctx.fillText(name, x + padding + circleR * 2 + 6, ey);
  }
}

// --- Scale bar (screen-space, bottom-right) ---

function drawScaleBar(w: number, h: number): void {
  // Pick a "nice" world-space distance that fills ~100-200px on screen
  const targetScreenPx = 150;
  const rawWorldDist = targetScreenPx / camera.zoom;
  // Round to a nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawWorldDist)));
  const candidates = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  let worldDist = candidates[0];
  for (const c of candidates) {
    if (c * camera.zoom >= 80 && c * camera.zoom <= 250) {
      worldDist = c;
      break;
    }
  }
  const barPx = worldDist * camera.zoom;

  // Format label
  let label: string;
  if (worldDist >= 1) {
    label = `${worldDist} \u00B5m`;
  } else {
    label = `${Math.round(worldDist * 1000)} nm`;
  }

  const padding = 12;
  const barHeight = 6;
  const x = w - barPx - padding;
  const y = h - padding - barHeight;

  // Background
  ctx.fillStyle = "rgba(30, 30, 30, 0.75)";
  ctx.beginPath();
  ctx.roundRect(x - 8, y - 20, barPx + 16, barHeight + 28, 4);
  ctx.fill();

  // Bar
  ctx.fillStyle = "#ccc";
  ctx.fillRect(x, y, barPx, barHeight);

  // Ticks at ends
  ctx.fillRect(x, y - 4, 2, barHeight + 8);
  ctx.fillRect(x + barPx - 2, y - 4, 2, barHeight + 8);

  // Label
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#ccc";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x + barPx / 2, y - 4);
}

// --- Render loop ---

function render(): void {
  const container = canvas.parentElement!;
  const w = container.clientWidth;
  const h = container.clientHeight;

  ctx.clearRect(0, 0, w, h);

  // World-space drawing
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  drawGrid(w, h);
  drawOrigin();
  drawComponents();
  drawSelection();

  ctx.restore();

  // Screen-space overlays
  drawLegend(w, h);
  drawScaleBar(w, h);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// --- Toolbar selection controls ---

function updateToolbarSelection(): void {
  const comp = getSelectedComponent();
  selectionToolbar.style.display = comp ? "flex" : "none";
}

btnRotate.addEventListener("click", () => {
  const comp = getSelectedComponent();
  if (comp) {
    comp.rotation = (comp.rotation + 90) % 360;
    vscode.postMessage({ type: "edit", data: documentData });
  }
});

btnFlipH.addEventListener("click", () => {
  const comp = getSelectedComponent();
  if (comp) {
    comp.flipH = !(comp.flipH ?? false);
    vscode.postMessage({ type: "edit", data: documentData });
  }
});

btnFlipV.addEventListener("click", () => {
  const comp = getSelectedComponent();
  if (comp) {
    comp.flipV = !(comp.flipV ?? false);
    vscode.postMessage({ type: "edit", data: documentData });
  }
});

btnExportGds.addEventListener("click", () => {
  btnExportGds.disabled = true;
  btnExportGds.textContent = "Exporting...";
  vscode.postMessage({ type: "exportGds" });
});

// --- Hit testing ---

function hitTestComponent(worldX: number, worldY: number): OfaComponent | null {
  if (!documentData) { return null; }
  // Iterate in reverse so topmost (last-placed) component is hit first
  for (let i = documentData.components.length - 1; i >= 0; i--) {
    const comp = documentData.components[i];
    const { w, h } = getDeviceSize(comp);
    if (
      worldX >= comp.x && worldX <= comp.x + w &&
      worldY >= comp.y && worldY <= comp.y + h
    ) {
      return comp;
    }
  }
  return null;
}

// --- Parameter editing overlay ---

let paramOverlay: HTMLDivElement | null = null;

function closeParamOverlay(): void {
  if (paramOverlay) {
    paramOverlay.remove();
    paramOverlay = null;
  }
}

function showParamOverlay(comp: OfaComponent, screenX: number, screenY: number): void {
  closeParamOverlay();

  const info = getCellInfo(comp.cell);
  const allParams = info ? { ...info.params, ...comp.params } : { ...comp.params };

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; left: ${screenX}px; top: ${screenY}px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-focusBorder, #007fd4);
    border-radius: 4px; padding: 8px; min-width: 200px; max-width: 320px;
    z-index: 1000; font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px; color: var(--vscode-editor-foreground, #ccc);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = "font-weight: bold; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1);";
  header.textContent = `${comp.cell} [${comp.id.substring(0, 6)}]`;
  overlay.appendChild(header);

  // Parameter inputs
  const inputs: { key: string; input: HTMLInputElement }[] = [];
  for (const [key, value] of Object.entries(allParams)) {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";

    const label = document.createElement("label");
    label.style.cssText = "flex: 0 0 80px; text-align: right; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
    label.textContent = key;
    label.title = key;
    row.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.value = String(value ?? "");
    input.style.cssText = `
      flex: 1; background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 2px; padding: 2px 4px; font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
    `;
    row.appendChild(input);
    overlay.appendChild(row);
    inputs.push({ key, input });
  }

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText = `
    background: var(--vscode-button-background, #007fd4);
    color: var(--vscode-button-foreground, #fff);
    border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;
  `;
  applyBtn.addEventListener("click", () => {
    // Re-find component in current documentData (it may have been replaced by an update)
    const liveComp = documentData?.components.find((c) => c.id === comp.id);
    if (!liveComp || !documentData) { closeParamOverlay(); return; }

    // Update component params
    for (const { key, input } of inputs) {
      const raw = input.value.trim();
      // Try to parse as number, then boolean, then keep as string
      const num = Number(raw);
      if (!isNaN(num) && raw !== "") {
        liveComp.params[key] = num;
      } else if (raw === "true") {
        liveComp.params[key] = true;
      } else if (raw === "false") {
        liveComp.params[key] = false;
      } else {
        liveComp.params[key] = raw;
      }
    }
    vscode.postMessage({ type: "edit", data: documentData });
    // Re-query GDSFactory for updated xsize/ysize/ports with new params
    if (!pendingQueries.has(liveComp.id)) {
      pendingQueries.add(liveComp.id);
      componentSizeCache.delete(liveComp.id);
      vscode.postMessage({
        type: "queryComponentInfo",
        componentId: liveComp.id,
        cellName: liveComp.cell,
        params: liveComp.params,
      });
    }
    closeParamOverlay();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = `
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;
  `;
  cancelBtn.addEventListener("click", closeParamOverlay);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.style.cssText = `
    background: #a02020; color: #fff;
    border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;
    margin-right: auto;
  `;
  deleteBtn.addEventListener("click", () => {
    if (documentData) {
      documentData.components = documentData.components.filter((c) => c.id !== comp.id);
      vscode.postMessage({ type: "edit", data: documentData });
    }
    closeParamOverlay();
  });

  btnRow.appendChild(deleteBtn);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(applyBtn);
  overlay.appendChild(btnRow);

  // Keep overlay within viewport
  document.body.appendChild(overlay);
  const rect = overlay.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    overlay.style.left = `${window.innerWidth - rect.width - 8}px`;
  }
  if (rect.bottom > window.innerHeight) {
    overlay.style.top = `${window.innerHeight - rect.height - 8}px`;
  }

  paramOverlay = overlay;
}

// --- Right-click context menu ---

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const world = screenToWorld(e.clientX, e.clientY);
  const comp = hitTestComponent(world.x, world.y);
  if (comp) {
    showParamOverlay(comp, e.clientX, e.clientY);
  } else {
    closeParamOverlay();
  }
});

// Close param overlay when clicking outside it
document.addEventListener("mousedown", (e) => {
  if (paramOverlay && !paramOverlay.contains(e.target as Node)) {
    closeParamOverlay();
  }
});

// --- Pan (Space + Click OR Middle Click) ---

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    spaceHeld = true;
    canvas.style.cursor = "grab";
    e.preventDefault();
    return;
  }

  // Skip shortcuts when typing in inputs or param overlay is open
  if (paramOverlay) { return; }
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { return; }

  const comp = getSelectedComponent();
  if (!comp) { return; }

  if (e.key === "r" || e.key === "R") {
    comp.rotation = (comp.rotation + 90) % 360;
    vscode.postMessage({ type: "edit", data: documentData });
    e.preventDefault();
  }
  if (e.key === "h" || e.key === "H") {
    comp.flipH = !(comp.flipH ?? false);
    vscode.postMessage({ type: "edit", data: documentData });
    e.preventDefault();
  }
  if (e.key === "v" || e.key === "V") {
    comp.flipV = !(comp.flipV ?? false);
    vscode.postMessage({ type: "edit", data: documentData });
    e.preventDefault();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (documentData) {
      documentData.components = documentData.components.filter((c) => c.id !== comp.id);
      selectedComponentId = null;
      updateToolbarSelection();
      vscode.postMessage({ type: "edit", data: documentData });
      e.preventDefault();
    }
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    isPanning = false;
    canvas.style.cursor = "default";
  }
});

canvas.addEventListener("mousedown", (e) => {
  // Middle click pan
  if (e.button === 1) {
    e.preventDefault();
    middlePanning = true;
    panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
    canvas.style.cursor = "grabbing";
    return;
  }
  // Space + left click pan
  if (spaceHeld && e.button === 0) {
    isPanning = true;
    panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
    canvas.style.cursor = "grabbing";
    return;
  }
  // Left click — select / drag / place
  if (e.button === 0 && !spaceHeld) {
    const world = screenToWorld(e.clientX, e.clientY);

    // 1. Check if clicking on any device → select + start drag
    const hitComp = hitTestComponent(world.x, world.y);
    if (hitComp) {
      selectedComponentId = hitComp.id;
      isDragging = true;
      dragStartWorld = { x: world.x, y: world.y };
      dragOrigPos = { x: hitComp.x, y: hitComp.y };
      canvas.style.cursor = "move";
      updateToolbarSelection();
      return;
    }

    // 3. Empty space + dropdown selected → place new component
    const selectedCell = componentSelect.value;
    if (selectedCell && documentData) {
      const info = getCellInfo(selectedCell);
      const defaultParams: Record<string, number | string | boolean> = {};
      if (info) {
        for (const [k, v] of Object.entries(info.params)) {
          if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
            defaultParams[k] = v;
          }
        }
      }
      const newComp: OfaComponent = {
        id: generateId(),
        cell: selectedCell,
        x: Math.round(world.x * 100) / 100,
        y: Math.round(world.y * 100) / 100,
        rotation: 0,
        params: defaultParams,
        _cache: info ? { xsize: info.xsize, ysize: info.ysize, ports: info.ports } : undefined,
      };
      if (newComp._cache) {
        componentSizeCache.set(newComp.id, newComp._cache);
      }
      documentData.components.push(newComp);
      selectedComponentId = newComp.id;
      vscode.postMessage({ type: "edit", data: documentData });
      updateToolbarSelection();
    } else {
      // 4. Empty space, no dropdown → deselect
      selectedComponentId = null;
      updateToolbarSelection();
    }
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (isPanning || middlePanning) {
    camera.x = e.clientX - panStart.x;
    camera.y = e.clientY - panStart.y;
    return;
  }

  const world = screenToWorld(e.clientX, e.clientY);

  if (isDragging) {
    const comp = getSelectedComponent();
    if (comp) {
      const dx = world.x - dragStartWorld.x;
      const dy = world.y - dragStartWorld.y;
      comp.x = Math.round((dragOrigPos.x + dx) * 100) / 100;
      comp.y = Math.round((dragOrigPos.y + dy) * 100) / 100;
    }
    return;
  }

  updateHoverCursor(world.x, world.y);
});

canvas.addEventListener("mouseup", (e) => {
  if (middlePanning && e.button === 1) {
    middlePanning = false;
    canvas.style.cursor = "default";
  }
  if (isPanning && e.button === 0) {
    isPanning = false;
    canvas.style.cursor = spaceHeld ? "grab" : "default";
  }
  if (isDragging && e.button === 0) {
    isDragging = false;
    canvas.style.cursor = "default";
    if (documentData) {
      vscode.postMessage({ type: "edit", data: documentData });
    }
  }
});

// Prevent context menu on middle click
canvas.addEventListener("auxclick", (e) => {
  if (e.button === 1) { e.preventDefault(); }
});

// --- Zoom (Scroll) ---

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    camera.x = mx - (mx - camera.x) * zoomFactor;
    camera.y = my - (my - camera.y) * zoomFactor;
    camera.zoom *= zoomFactor;
    camera.zoom = Math.max(1, Math.min(10000, camera.zoom));
  },
  { passive: false }
);

// --- Message handling ---

function populateSelect(select: HTMLSelectElement, items: { name: string }[], placeholder: string): void {
  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = placeholder;
  select.appendChild(defaultOpt);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "update":
      documentData = msg.data as DocumentData;
      // Seed size cache from persisted _cache for instant rendering on reload
      if (documentData) {
        for (const comp of documentData.components) {
          if (comp._cache && !componentSizeCache.has(comp.id)) {
            componentSizeCache.set(comp.id, comp._cache);
          }
        }
      }
      if (selectedComponentId) {
        const stillExists = documentData.components.some((c) => c.id === selectedComponentId);
        if (!stillExists) {
          selectedComponentId = null;
          updateToolbarSelection();
        }
      }
      // Clean stale cache entries for deleted components
      if (documentData) {
        const currentIds = new Set(documentData.components.map((c) => c.id));
        for (const cachedId of componentSizeCache.keys()) {
          if (!currentIds.has(cachedId)) { componentSizeCache.delete(cachedId); }
        }
        // Re-query components with custom params that aren't cached yet
        for (const comp of documentData.components) {
          if (componentSizeCache.has(comp.id) || pendingQueries.has(comp.id)) { continue; }
          const info = getCellInfo(comp.cell);
          if (!info) { continue; }
          const hasDiff = Object.keys(comp.params).some((k) => {
            const compVal = comp.params[k];
            const defVal = info.params[k];
            return typeof compVal === "number" && compVal !== defVal;
          });
          if (hasDiff) {
            pendingQueries.add(comp.id);
            vscode.postMessage({
              type: "queryComponentInfo",
              componentId: comp.id,
              cellName: comp.cell,
              params: comp.params,
            });
          }
        }
      }
      break;
    case "pdkData": {
      pdkCells = (msg.cells || []) as PdkCellInfo[];
      const connectivity = (msg.connectivity || []) as { name: string }[];
      populateSelect(componentSelect, pdkCells, "-- Select Device --");
      populateSelect(junctionSelect, connectivity, "-- Select Junction --");
      break;
    }
    case "componentInfoResult": {
      pendingQueries.delete(msg.componentId);
      if (msg.error) {
        console.warn(`OFA: Component query failed for ${msg.componentId}: ${msg.error}`);
      } else {
        const cached = { xsize: msg.xsize, ysize: msg.ysize, ports: msg.ports };
        componentSizeCache.set(msg.componentId, cached);
        // Persist cache into .ofa document for instant reload
        if (documentData) {
          const comp = documentData.components.find((c) => c.id === msg.componentId);
          if (comp) {
            comp._cache = cached;
            vscode.postMessage({ type: "edit", data: documentData });
          }
        }
      }
      break;
    }
    case "exportGdsResult": {
      btnExportGds.disabled = false;
      btnExportGds.textContent = "Export GDS";
      if (msg.error) {
        console.warn(`OFA: GDS export failed: ${msg.error}`);
      }
      break;
    }
  }
});

// Notify extension that webview is ready
vscode.postMessage({ type: "ready" });
