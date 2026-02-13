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

type JunctionStyle = "h2" | "v2" | "d2" | "x4" | "hp" | "vp";

interface OfaJunction {
  id: string;
  x: number;
  y: number;
  style: JunctionStyle;
}

interface OfaWire {
  id: string;
  layer: string;
  width: number;
  startId: string;
  startType: "port" | "junction";
  startComponentId?: string;
  endId: string;
  endType: "port" | "junction";
  endComponentId?: string;
}

interface DocumentData {
  version: number;
  components: OfaComponent[];
  junctions: OfaJunction[];
  wires: OfaWire[];
}

interface WireAnchor {
  type: "port" | "junction";
  id: string;
  componentId?: string;
  x: number;
  y: number;
}

interface SelectionState {
  type: "none" | "component" | "junction" | "wire";
  id: string | null;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// --- Layer color map (populated from PDK — empty until pdkData arrives) ---

const LAYER_COLORS: Record<string, string> = {};
const GDS_LAYER_NAMES: Record<number, string> = {};

function applyPdkLayers(layers: { name: string; gds_layer: [number, number]; color: string }[]): void {

  for (const layer of layers) {
    LAYER_COLORS[layer.name] = layer.color;
    GDS_LAYER_NAMES[layer.gds_layer[0]] = layer.name;
  }

  wireLayerSelect.innerHTML = "";
  for (const name of Object.keys(LAYER_COLORS)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    wireLayerSelect.appendChild(opt);
  }
}

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

// --- Constants ---

const JUNCTION_RADIUS = 0.15;

// --- State ---

const vscode = acquireVsCodeApi();

const canvas = document.getElementById("ofaCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const componentSelect = document.getElementById("componentSelect") as HTMLSelectElement;
const selectionToolbar = document.getElementById("selectionToolbar") as HTMLDivElement;
const btnRotate = document.getElementById("btnRotate") as HTMLButtonElement;
const btnFlipH = document.getElementById("btnFlipH") as HTMLButtonElement;
const btnFlipV = document.getElementById("btnFlipV") as HTMLButtonElement;
const btnExportGds = document.getElementById("btnExportGds") as HTMLButtonElement;
const btnWireMode = document.getElementById("btnWireMode") as HTMLButtonElement;
const wireLayerSelect = document.getElementById("wireLayerSelect") as HTMLSelectElement;

// Default zoom 200x so sub-micron devices (e.g. 0.42 x 0.15 um) are visible
const camera: Camera = { x: 0, y: 0, zoom: 200 };
let spaceHeld = false;
let isPanning = false;
let middlePanning = false;
let panStart = { x: 0, y: 0 };
let documentData: DocumentData | null = null;
let pdkCells: PdkCellInfo[] = [];

// --- Selection & interaction state ---
let selection: SelectionState = { type: "none", id: null };
let isDragging = false;
let dragStartWorld = { x: 0, y: 0 };
let dragOrigPos = { x: 0, y: 0 };

// --- Wire mode state ---
let wireMode = false;
let wireDrawing = false;
let wireStartAnchor: WireAnchor | null = null;
let wirePreviewEnd: { x: number; y: number } | null = null;

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
  const cached = componentSizeCache.get(comp.id);
  if (cached) {
    return { w: Math.max(cached.xsize, 0.05), h: Math.max(cached.ysize, 0.05) };
  }
  const info = getCellInfo(comp.cell);
  if (info) {
    return { w: Math.max(info.xsize, 0.05), h: Math.max(info.ysize, 0.05) };
  }
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
  if (!documentData || selection.type !== "component" || !selection.id) { return null; }
  return documentData.components.find((c) => c.id === selection.id) ?? null;
}

function getSelectedJunction(): OfaJunction | null {
  if (!documentData || selection.type !== "junction" || !selection.id) { return null; }
  return documentData.junctions.find((j) => j.id === selection.id) ?? null;
}

function getSelectedWire(): OfaWire | null {
  if (!documentData || selection.type !== "wire" || !selection.id) { return null; }
  return documentData.wires.find((w) => w.id === selection.id) ?? null;
}

function clearSelection(): void {
  selection = { type: "none", id: null };
  updateToolbarSelection();
}

function updateHoverCursor(worldX: number, worldY: number): void {
  if (spaceHeld || wireMode) { return; }
  const j = hitTestJunction(worldX, worldY);
  if (j) { canvas.style.cursor = "pointer"; return; }
  const comp = hitTestComponent(worldX, worldY);
  if (comp) {
    canvas.style.cursor = selection.type === "component" && selection.id === comp.id ? "move" : "pointer";
    return;
  }
  const w = hitTestWire(worldX, worldY);
  if (w) { canvas.style.cursor = "pointer"; return; }
  canvas.style.cursor = "default";
}

// --- Port world transform ---

function transformPortToWorld(comp: OfaComponent, port: PdkPortInfo): { x: number; y: number } {
  const { w, h } = getDeviceSize(comp);
  let px = port.x;
  let py = port.y;

  if (comp.flipH) { px = w - px; }
  if (comp.flipV) { py = h - py; }
  if (comp.rotation) {
    const cx = w / 2, cy = h / 2;
    const rad = (comp.rotation * Math.PI) / 180;
    const rx = px - cx, ry = py - cy;
    px = cx + rx * Math.cos(rad) - ry * Math.sin(rad);
    py = cy + rx * Math.sin(rad) + ry * Math.cos(rad);
  }
  return { x: comp.x + px, y: comp.y + py };
}

function resolveAnchorPosition(id: string, type: "port" | "junction", componentId?: string): { x: number; y: number } | null {
  if (type === "junction") {
    const j = documentData?.junctions.find((jn) => jn.id === id);
    return j ? { x: j.x, y: j.y } : null;
  }
  if (!componentId || !documentData) { return null; }
  const comp = documentData.components.find((c) => c.id === componentId);
  if (!comp) { return null; }
  const cached = componentSizeCache.get(comp.id);
  const info = getCellInfo(comp.cell);
  const ports = cached ? cached.ports : (info ? info.ports : []);
  const port = ports.find((p) => p.name === id);
  if (!port) { return null; }
  return transformPortToWorld(comp, port);
}

// --- Wire helpers ---

function snapWireEnd(startX: number, startY: number, mouseX: number, mouseY: number): { x: number; y: number } {
  const dx = Math.abs(mouseX - startX);
  const dy = Math.abs(mouseY - startY);
  if (dx >= dy) {
    return { x: Math.round(mouseX * 100) / 100, y: startY };
  } else {
    return { x: startX, y: Math.round(mouseY * 100) / 100 };
  }
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function cleanupOrphanedJunctions(): void {
  if (!documentData) { return; }
  documentData.junctions = documentData.junctions.filter((j) => {
    return documentData!.wires.some((w) =>
      (w.startType === "junction" && w.startId === j.id) ||
      (w.endType === "junction" && w.endId === j.id)
    );
  });
}

function deleteComponentCascade(compId: string): void {
  if (!documentData) { return; }
  documentData.components = documentData.components.filter((c) => c.id !== compId);
  documentData.wires = documentData.wires.filter((w) =>
    !(w.startType === "port" && w.startComponentId === compId) &&
    !(w.endType === "port" && w.endComponentId === compId)
  );
  cleanupOrphanedJunctions();
}

function deleteJunctionCascade(jId: string): void {
  if (!documentData) { return; }
  documentData.junctions = documentData.junctions.filter((j) => j.id !== jId);
  documentData.wires = documentData.wires.filter((w) =>
    !(w.startType === "junction" && w.startId === jId) &&
    !(w.endType === "junction" && w.endId === jId)
  );
}

function deleteWireCascade(wId: string): void {
  if (!documentData) { return; }
  documentData.wires = documentData.wires.filter((w) => w.id !== wId);
  cleanupOrphanedJunctions();
}

// --- Junction auto-coloring ---

function computeJunctionColors(junction: OfaJunction): string[] {
  if (!documentData) { return ["#888", "#888", "#888", "#888"]; }

  const connected = documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junction.id) ||
    (w.endType === "junction" && w.endId === junction.id)
  );

  if (connected.length === 0) { return ["#888", "#888", "#888", "#888"]; }

  const dirs: { layer: string; dir: "N" | "E" | "S" | "W" }[] = [];
  for (const wire of connected) {
    const isStart = wire.startType === "junction" && wire.startId === junction.id;
    const otherPos = resolveAnchorPosition(
      isStart ? wire.endId : wire.startId,
      isStart ? wire.endType : wire.startType,
      isStart ? wire.endComponentId : wire.startComponentId,
    );
    if (!otherPos) { continue; }
    const ddx = otherPos.x - junction.x;
    const ddy = otherPos.y - junction.y;
    let dir: "N" | "E" | "S" | "W";
    if (Math.abs(ddx) > Math.abs(ddy)) {
      dir = ddx > 0 ? "E" : "W";
    } else {
      dir = ddy > 0 ? "S" : "N";
    }
    dirs.push({ layer: wire.layer, dir });
  }

  const colorOf = (layer: string) => LAYER_COLORS[layer] || "#888";
  const fallback = connected[0]?.layer || "";

  switch (junction.style) {
    case "h2": {
      const left = dirs.find((d) => d.dir === "W");
      const right = dirs.find((d) => d.dir === "E");
      return [colorOf(left?.layer || fallback), colorOf(right?.layer || fallback)];
    }
    case "v2": {
      const top = dirs.find((d) => d.dir === "N");
      const bottom = dirs.find((d) => d.dir === "S");
      return [colorOf(top?.layer || fallback), colorOf(bottom?.layer || fallback)];
    }
    case "d2": {
      return [colorOf(connected[0]?.layer || ""), colorOf(connected[1]?.layer || connected[0]?.layer || "")];
    }
    case "x4": {
      const n = dirs.find((d) => d.dir === "N");
      const e = dirs.find((d) => d.dir === "E");
      const s = dirs.find((d) => d.dir === "S");
      const w = dirs.find((d) => d.dir === "W");
      return [colorOf(n?.layer || fallback), colorOf(e?.layer || fallback),
              colorOf(s?.layer || fallback), colorOf(w?.layer || fallback)];
    }
    case "hp": {
      const left = dirs.find((d) => d.dir === "W");
      const right = dirs.find((d) => d.dir === "E");
      return [colorOf(left?.layer || fallback), colorOf(right?.layer || fallback)];
    }
    case "vp": {
      const top = dirs.find((d) => d.dir === "N");
      const bottom = dirs.find((d) => d.dir === "S");
      return [colorOf(top?.layer || fallback), colorOf(bottom?.layer || fallback)];
    }
  }
  return ["#888"];
}

function autoUpdateJunctionStyle(junctionId: string): void {
  if (!documentData) { return; }
  const junction = documentData.junctions.find((j) => j.id === junctionId);
  if (!junction) { return; }

  // Via-port junctions are explicitly user-chosen — don't auto-change
  if (junction.style === "hp" || junction.style === "vp") { return; }

  const connected = documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );

  const dirSet = new Set<string>();
  for (const wire of connected) {
    const isStart = wire.startType === "junction" && wire.startId === junctionId;
    const otherPos = resolveAnchorPosition(
      isStart ? wire.endId : wire.startId,
      isStart ? wire.endType : wire.startType,
      isStart ? wire.endComponentId : wire.startComponentId,
    );
    if (!otherPos) { continue; }
    const ddx = otherPos.x - junction.x;
    const ddy = otherPos.y - junction.y;
    if (Math.abs(ddx) > Math.abs(ddy)) {
      dirSet.add(ddx > 0 ? "E" : "W");
    } else {
      dirSet.add(ddy > 0 ? "S" : "N");
    }
  }

  if (connected.length >= 3 || dirSet.size >= 3) {
    junction.style = "x4";
  } else if (dirSet.has("N") && dirSet.has("S") && !dirSet.has("E") && !dirSet.has("W")) {
    junction.style = "v2";
  } else if (dirSet.has("E") && dirSet.has("W") && !dirSet.has("N") && !dirSet.has("S")) {
    junction.style = "h2";
  } else {
    junction.style = "d2";
  }
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
  const minScreenSpacing = 20;
  const idealScreenSpacing = 50;
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

// --- Wire rendering ---

function drawWires(): void {
  if (!documentData) { return; }

  for (const wire of documentData.wires) {
    const start = resolveAnchorPosition(wire.startId, wire.startType, wire.startComponentId);
    const end = resolveAnchorPosition(wire.endId, wire.endType, wire.endComponentId);
    if (!start || !end) { continue; }

    const color = LAYER_COLORS[wire.layer] || "#888";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(wire.width, 0.05);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  // Wire preview during drawing
  if (wireDrawing && wireStartAnchor && wirePreviewEnd) {
    const snapped = snapWireEnd(wireStartAnchor.x, wireStartAnchor.y, wirePreviewEnd.x, wirePreviewEnd.y);
    const color = LAYER_COLORS[wireLayerSelect.value] || "#888";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.1;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([0.1, 0.05]);
    ctx.beginPath();
    ctx.moveTo(wireStartAnchor.x, wireStartAnchor.y);
    ctx.lineTo(snapped.x, snapped.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// --- Junction rendering ---

function drawJunctions(): void {
  if (!documentData) { return; }

  for (const junction of documentData.junctions) {
    const colors = computeJunctionColors(junction);
    const r = JUNCTION_RADIUS;

    ctx.save();
    ctx.translate(junction.x, junction.y);

    switch (junction.style) {
      case "h2":
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2);
        ctx.fill();
        ctx.fillStyle = colors[1];
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        break;
      case "v2":
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = colors[1];
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI);
        ctx.fill();
        break;
      case "d2":
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, -Math.PI * 0.75, Math.PI * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = colors[1];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, Math.PI * 0.25, -Math.PI * 0.75);
        ctx.closePath();
        ctx.fill();
        break;
      case "x4":
        for (let q = 0; q < 4; q++) {
          ctx.fillStyle = colors[q] || "#888";
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r, (q - 1.5) * Math.PI / 2, (q - 0.5) * Math.PI / 2);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case "hp":
        ctx.fillStyle = colors[0];
        ctx.fillRect(-r, -r, r, r * 2);
        ctx.fillStyle = colors[1];
        ctx.fillRect(0, -r, r, r * 2);
        break;
      case "vp":
        ctx.fillStyle = colors[0];
        ctx.fillRect(-r, -r, r * 2, r);
        ctx.fillStyle = colors[1];
        ctx.fillRect(-r, 0, r * 2, r);
        break;
    }

    // Outline
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 0.5 / camera.zoom;
    if (junction.style === "hp" || junction.style === "vp") {
      ctx.strokeRect(-r, -r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// --- Device rendering ---

function fitText(text: string, maxW: number, maxH: number, maxFontSize: number): number {
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

    // Device labels
    const padX = w * 0.1;
    const padY = h * 0.1;
    const availW = w - padX * 2;
    const availH = (h - padY * 2) / 2;

    const shortId = comp.id.substring(0, 6);
    const cellFontSize = fitText(comp.cell, availW, availH * 0.9, h * 0.4);
    const idFontSize = fitText(shortId, availW, availH * 0.9, h * 0.3);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(220, 230, 255, 0.9)";

    ctx.font = `bold ${cellFontSize}px sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText(comp.cell, w / 2, h / 2);

    ctx.font = `${idFontSize}px sans-serif`;
    ctx.fillStyle = "rgba(180, 200, 230, 0.7)";
    ctx.textBaseline = "top";
    ctx.fillText(shortId, w / 2, h / 2);

    // Ports
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
  if (selection.type === "component") {
    const comp = getSelectedComponent();
    if (!comp) { return; }
    const { w, h } = getDeviceSize(comp);

    ctx.save();
    ctx.translate(comp.x, comp.y);
    applyComponentTransform(comp, w, h);
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
    ctx.strokeRect(0, 0, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  } else if (selection.type === "junction") {
    const j = getSelectedJunction();
    if (!j) { return; }
    ctx.save();
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
    const sr = JUNCTION_RADIUS * 1.4;
    if (j.style === "hp" || j.style === "vp") {
      ctx.strokeRect(j.x - sr, j.y - sr, sr * 2, sr * 2);
    } else {
      ctx.beginPath();
      ctx.arc(j.x, j.y, sr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  } else if (selection.type === "wire") {
    const w = getSelectedWire();
    if (!w) { return; }
    const start = resolveAnchorPosition(w.startId, w.startType, w.startComponentId);
    const end = resolveAnchorPosition(w.endId, w.endType, w.endComponentId);
    if (!start || !end) { return; }
    ctx.save();
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = w.width + 0.08;
    ctx.lineCap = "round";
    ctx.setLineDash([0.1, 0.05]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
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

  ctx.fillStyle = "rgba(30, 30, 30, 0.75)";
  ctx.beginPath();
  ctx.roundRect(x, y, legendW, legendH, 4);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "11px sans-serif";

  for (let i = 0; i < entries.length; i++) {
    const [name, color] = entries[i];
    const ey = y + padding + i * lineHeight + lineHeight / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + padding + circleR, ey, circleR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ccc";
    ctx.fillText(name, x + padding + circleR * 2 + 6, ey);
  }
}

// --- Scale bar (screen-space, bottom-right) ---

function drawScaleBar(w: number, h: number): void {
  const targetScreenPx = 150;
  const rawWorldDist = targetScreenPx / camera.zoom;
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

  ctx.fillStyle = "rgba(30, 30, 30, 0.75)";
  ctx.beginPath();
  ctx.roundRect(x - 8, y - 20, barPx + 16, barHeight + 28, 4);
  ctx.fill();

  ctx.fillStyle = "#ccc";
  ctx.fillRect(x, y, barPx, barHeight);
  ctx.fillRect(x, y - 4, 2, barHeight + 8);
  ctx.fillRect(x + barPx - 2, y - 4, 2, barHeight + 8);

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
  drawWires();
  drawComponents();
  drawJunctions();
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

btnWireMode.addEventListener("click", () => {
  wireMode = !wireMode;
  btnWireMode.classList.toggle("active", wireMode);
  if (!wireMode) {
    wireDrawing = false;
    wireStartAnchor = null;
    wirePreviewEnd = null;
  }
  canvas.style.cursor = wireMode ? "crosshair" : "default";
});

// --- Hit testing ---

function hitTestComponent(worldX: number, worldY: number): OfaComponent | null {
  if (!documentData) { return null; }
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

function hitTestJunction(worldX: number, worldY: number): OfaJunction | null {
  if (!documentData) { return null; }
  const r = JUNCTION_RADIUS;
  for (let i = documentData.junctions.length - 1; i >= 0; i--) {
    const j = documentData.junctions[i];
    const dx = worldX - j.x;
    const dy = worldY - j.y;
    if (j.style === "hp" || j.style === "vp") {
      if (Math.abs(dx) <= r && Math.abs(dy) <= r) { return j; }
    } else {
      if (dx * dx + dy * dy <= r * r) { return j; }
    }
  }
  return null;
}

function hitTestWire(worldX: number, worldY: number): OfaWire | null {
  if (!documentData) { return null; }
  const threshold = Math.max(0.1, 5 / camera.zoom);
  for (let i = documentData.wires.length - 1; i >= 0; i--) {
    const wire = documentData.wires[i];
    const start = resolveAnchorPosition(wire.startId, wire.startType, wire.startComponentId);
    const end = resolveAnchorPosition(wire.endId, wire.endType, wire.endComponentId);
    if (!start || !end) { continue; }
    const dist = pointToSegmentDist(worldX, worldY, start.x, start.y, end.x, end.y);
    if (dist <= Math.max(wire.width / 2, threshold)) { return wire; }
  }
  return null;
}

function hitTestPort(worldX: number, worldY: number): WireAnchor | null {
  if (!documentData) { return null; }
  for (const comp of documentData.components) {
    const cached = componentSizeCache.get(comp.id);
    const info = getCellInfo(comp.cell);
    const ports = cached ? cached.ports : (info ? info.ports : []);
    const { w, h } = getDeviceSize(comp);
    const portSize = Math.max(0.3, Math.min(w, h) * 0.08);
    for (const port of ports) {
      const worldPort = transformPortToWorld(comp, port);
      if (Math.abs(worldX - worldPort.x) <= portSize &&
          Math.abs(worldY - worldPort.y) <= portSize) {
        return {
          type: "port",
          id: port.name,
          componentId: comp.id,
          x: worldPort.x,
          y: worldPort.y,
        };
      }
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

  const header = document.createElement("div");
  header.style.cssText = "font-weight: bold; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1);";
  header.textContent = `${comp.cell} [${comp.id.substring(0, 6)}]`;
  overlay.appendChild(header);

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
    const liveComp = documentData?.components.find((c) => c.id === comp.id);
    if (!liveComp || !documentData) { closeParamOverlay(); return; }

    for (const { key, input } of inputs) {
      const raw = input.value.trim();
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
      deleteComponentCascade(comp.id);
      vscode.postMessage({ type: "edit", data: documentData });
    }
    closeParamOverlay();
  });

  btnRow.appendChild(deleteBtn);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(applyBtn);
  overlay.appendChild(btnRow);

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

// --- Wire editing overlay ---

function showWireOverlay(wire: OfaWire, screenX: number, screenY: number): void {
  closeParamOverlay();

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; left: ${screenX}px; top: ${screenY}px;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-focusBorder, #007fd4);
    border-radius: 4px; padding: 8px; min-width: 180px;
    z-index: 1000; font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px; color: var(--vscode-editor-foreground, #ccc);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;

  const header = document.createElement("div");
  header.style.cssText = "font-weight: bold; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1);";
  header.textContent = `Wire [${wire.id.substring(0, 6)}]`;
  overlay.appendChild(header);

  // Layer selector
  const layerRow = document.createElement("div");
  layerRow.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";
  const layerLabel = document.createElement("label");
  layerLabel.style.cssText = "flex: 0 0 50px; text-align: right; opacity: 0.7;";
  layerLabel.textContent = "Layer";
  layerRow.appendChild(layerLabel);
  const layerSel = document.createElement("select");
  layerSel.style.cssText = `flex: 1; background: var(--vscode-dropdown-background, #3c3c3c); color: var(--vscode-dropdown-foreground, #ccc); border: 1px solid var(--vscode-dropdown-border, #555); border-radius: 2px; padding: 2px 4px; font-size: 11px;`;
  for (const name of Object.keys(LAYER_COLORS)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === wire.layer) { opt.selected = true; }
    layerSel.appendChild(opt);
  }
  layerRow.appendChild(layerSel);
  overlay.appendChild(layerRow);

  // Width input
  const widthRow = document.createElement("div");
  widthRow.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";
  const widthLabel = document.createElement("label");
  widthLabel.style.cssText = "flex: 0 0 50px; text-align: right; opacity: 0.7;";
  widthLabel.textContent = "Width";
  widthRow.appendChild(widthLabel);
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "0.01";
  widthInput.step = "0.01";
  widthInput.value = String(wire.width);
  widthInput.style.cssText = `flex: 1; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); border-radius: 2px; padding: 2px 4px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);`;
  widthRow.appendChild(widthInput);
  overlay.appendChild(widthRow);

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText = `background: var(--vscode-button-background, #007fd4); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;`;
  applyBtn.addEventListener("click", () => {
    const liveWire = documentData?.wires.find((w) => w.id === wire.id);
    if (!liveWire || !documentData) { closeParamOverlay(); return; }
    liveWire.layer = layerSel.value;
    liveWire.width = Math.max(0.01, Number(widthInput.value) || 0.1);
    // Update connected junction styles
    if (liveWire.startType === "junction") { autoUpdateJunctionStyle(liveWire.startId); }
    if (liveWire.endType === "junction") { autoUpdateJunctionStyle(liveWire.endId); }
    vscode.postMessage({ type: "edit", data: documentData });
    closeParamOverlay();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = `background: var(--vscode-button-secondaryBackground, #3c3c3c); color: var(--vscode-button-secondaryForeground, #ccc); border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;`;
  cancelBtn.addEventListener("click", closeParamOverlay);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.style.cssText = `background: #a02020; color: #fff; border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px; margin-right: auto;`;
  deleteBtn.addEventListener("click", () => {
    if (documentData) {
      deleteWireCascade(wire.id);
      clearSelection();
      vscode.postMessage({ type: "edit", data: documentData });
    }
    closeParamOverlay();
  });

  btnRow.appendChild(deleteBtn);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(applyBtn);
  overlay.appendChild(btnRow);

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

  // In wire mode, right-click cancels drawing
  if (wireDrawing) {
    wireDrawing = false;
    wireStartAnchor = null;
    wirePreviewEnd = null;
    return;
  }

  const world = screenToWorld(e.clientX, e.clientY);

  const wire = hitTestWire(world.x, world.y);
  if (wire) {
    showWireOverlay(wire, e.clientX, e.clientY);
    return;
  }

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

  // Escape: cancel wire drawing or exit wire mode
  if (e.key === "Escape") {
    if (wireDrawing) {
      wireDrawing = false;
      wireStartAnchor = null;
      wirePreviewEnd = null;
      e.preventDefault();
      return;
    }
    if (wireMode) {
      wireMode = false;
      btnWireMode.classList.remove("active");
      canvas.style.cursor = "default";
      e.preventDefault();
      return;
    }
  }

  // W: toggle wire mode
  if (e.key === "w" || e.key === "W") {
    btnWireMode.click();
    e.preventDefault();
    return;
  }

  // Component shortcuts (only when component is selected)
  const comp = getSelectedComponent();
  if (comp) {
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
  }

  // Delete: works for component, junction, or wire
  if (e.key === "Delete" || e.key === "Backspace") {
    if (!documentData) { return; }
    if (selection.type === "component" && selection.id) {
      deleteComponentCascade(selection.id);
      clearSelection();
      vscode.postMessage({ type: "edit", data: documentData });
      e.preventDefault();
    } else if (selection.type === "junction" && selection.id) {
      deleteJunctionCascade(selection.id);
      clearSelection();
      vscode.postMessage({ type: "edit", data: documentData });
      e.preventDefault();
    } else if (selection.type === "wire" && selection.id) {
      deleteWireCascade(selection.id);
      clearSelection();
      vscode.postMessage({ type: "edit", data: documentData });
      e.preventDefault();
    }
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    isPanning = false;
    canvas.style.cursor = wireMode ? "crosshair" : "default";
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
  // Left click
  if (e.button === 0 && !spaceHeld) {
    const world = screenToWorld(e.clientX, e.clientY);

    // --- WIRE MODE ---
    if (wireMode && documentData) {
      if (!wireDrawing) {
        // Start wire from port, junction, or empty space
        const portHit = hitTestPort(world.x, world.y);
        if (portHit) {
          wireStartAnchor = portHit;
          wireDrawing = true;
          return;
        }
        const jHit = hitTestJunction(world.x, world.y);
        if (jHit) {
          wireStartAnchor = { type: "junction", id: jHit.id, x: jHit.x, y: jHit.y };
          wireDrawing = true;
          return;
        }
        // Empty space: create junction and start from it
        const snapped = { x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 };
        const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
        documentData.junctions.push(newJ);
        wireStartAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
        wireDrawing = true;
        vscode.postMessage({ type: "edit", data: documentData });
        return;
      } else {
        // Complete wire
        const snapped = snapWireEnd(wireStartAnchor!.x, wireStartAnchor!.y, world.x, world.y);

        // Try to end on port or junction
        let endAnchor: WireAnchor | null = hitTestPort(snapped.x, snapped.y);
        if (!endAnchor) {
          const jHit = hitTestJunction(snapped.x, snapped.y);
          if (jHit) {
            endAnchor = { type: "junction", id: jHit.id, x: jHit.x, y: jHit.y };
          }
        }

        if (!endAnchor) {
          // Create junction at snapped position
          const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
          documentData.junctions.push(newJ);
          endAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
        }

        // Don't create zero-length wires
        if (wireStartAnchor!.id === endAnchor.id && wireStartAnchor!.type === endAnchor.type) {
          return;
        }

        const newWire: OfaWire = {
          id: generateId(),
          layer: wireLayerSelect.value,
          width: 0.1,
          startId: wireStartAnchor!.id,
          startType: wireStartAnchor!.type,
          startComponentId: wireStartAnchor!.componentId,
          endId: endAnchor.id,
          endType: endAnchor.type,
          endComponentId: endAnchor.componentId,
        };
        documentData.wires.push(newWire);

        // Auto-update junction styles
        if (wireStartAnchor!.type === "junction") { autoUpdateJunctionStyle(wireStartAnchor!.id); }
        if (endAnchor.type === "junction") { autoUpdateJunctionStyle(endAnchor.id); }

        vscode.postMessage({ type: "edit", data: documentData });

        // Chain: start next wire from end anchor
        wireStartAnchor = endAnchor;
        return;
      }
    }

    // --- NORMAL MODE ---

    // 1. Hit test junction (small, high priority)
    const jHit = hitTestJunction(world.x, world.y);
    if (jHit) {
      selection = { type: "junction", id: jHit.id };
      isDragging = true;
      dragStartWorld = { x: world.x, y: world.y };
      dragOrigPos = { x: jHit.x, y: jHit.y };
      canvas.style.cursor = "move";
      updateToolbarSelection();
      return;
    }

    // 2. Hit test component
    const hitComp = hitTestComponent(world.x, world.y);
    if (hitComp) {
      selection = { type: "component", id: hitComp.id };
      isDragging = true;
      dragStartWorld = { x: world.x, y: world.y };
      dragOrigPos = { x: hitComp.x, y: hitComp.y };
      canvas.style.cursor = "move";
      updateToolbarSelection();
      return;
    }

    // 3. Hit test wire
    const wHit = hitTestWire(world.x, world.y);
    if (wHit) {
      selection = { type: "wire", id: wHit.id };
      updateToolbarSelection();
      return;
    }

    // 4. Empty space + dropdown selected → place new component
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
      selection = { type: "component", id: newComp.id };
      vscode.postMessage({ type: "edit", data: documentData });
      updateToolbarSelection();
    } else {
      // 5. Empty space, no dropdown → deselect
      clearSelection();
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

  // Wire preview
  if (wireDrawing && wireStartAnchor) {
    wirePreviewEnd = { x: world.x, y: world.y };
    return;
  }

  if (isDragging) {
    if (selection.type === "component") {
      const comp = getSelectedComponent();
      if (comp) {
        const dx = world.x - dragStartWorld.x;
        const dy = world.y - dragStartWorld.y;
        comp.x = Math.round((dragOrigPos.x + dx) * 100) / 100;
        comp.y = Math.round((dragOrigPos.y + dy) * 100) / 100;
      }
    } else if (selection.type === "junction") {
      const j = getSelectedJunction();
      if (j) {
        const dx = world.x - dragStartWorld.x;
        const dy = world.y - dragStartWorld.y;
        j.x = Math.round((dragOrigPos.x + dx) * 100) / 100;
        j.y = Math.round((dragOrigPos.y + dy) * 100) / 100;
      }
    }
    return;
  }

  updateHoverCursor(world.x, world.y);
});

canvas.addEventListener("mouseup", (e) => {
  if (middlePanning && e.button === 1) {
    middlePanning = false;
    canvas.style.cursor = wireMode ? "crosshair" : "default";
  }
  if (isPanning && e.button === 0) {
    isPanning = false;
    canvas.style.cursor = spaceHeld ? "grab" : (wireMode ? "crosshair" : "default");
  }
  if (isDragging && e.button === 0) {
    isDragging = false;
    canvas.style.cursor = wireMode ? "crosshair" : "default";
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
      // Ensure junctions/wires arrays exist (for legacy .ofa files)
      if (documentData && !documentData.junctions) { documentData.junctions = []; }
      if (documentData && !documentData.wires) { documentData.wires = []; }
      // Seed size cache from persisted _cache for instant rendering on reload
      if (documentData) {
        for (const comp of documentData.components) {
          if (comp._cache && !componentSizeCache.has(comp.id)) {
            componentSizeCache.set(comp.id, comp._cache);
          }
        }
      }
      if (selection.type === "component" && selection.id) {
        const stillExists = documentData.components.some((c) => c.id === selection.id);
        if (!stillExists) { clearSelection(); }
      } else if (selection.type === "junction" && selection.id) {
        const stillExists = documentData.junctions.some((j) => j.id === selection.id);
        if (!stillExists) { clearSelection(); }
      } else if (selection.type === "wire" && selection.id) {
        const stillExists = documentData.wires.some((w) => w.id === selection.id);
        if (!stillExists) { clearSelection(); }
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
      populateSelect(componentSelect, pdkCells, "-- Select Device --");
      if (msg.layers && Array.isArray(msg.layers)) {
        applyPdkLayers(msg.layers);
      }
      break;
    }
    case "componentInfoResult": {
      pendingQueries.delete(msg.componentId);
      if (msg.error) {
        console.warn(`OFA: Component query failed for ${msg.componentId}: ${msg.error}`);
      } else {
        const cached = { xsize: msg.xsize, ysize: msg.ysize, ports: msg.ports };
        componentSizeCache.set(msg.componentId, cached);
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
