// Global mutable state, constants, DOM refs, save mechanism, and utility helpers

import type { Camera, DocumentData, IncludeGeometry, PdkCellInfo, PdkPortInfo, SelectionState, WireAnchor } from "./types";

// --- Constants ---

export const JUNCTION_RADIUS = 0.15;

// --- VSCode API ---

export const vscode = acquireVsCodeApi();

// --- DOM refs ---

export const canvas = document.getElementById("ofaCanvas") as HTMLCanvasElement;
export const ctx = canvas.getContext("2d")!;
export const componentSelect = document.getElementById("componentSelect") as HTMLSelectElement;
export const selectionToolbar = document.getElementById("selectionToolbar") as HTMLDivElement;
export const btnRotate = document.getElementById("btnRotate") as HTMLButtonElement;
export const btnFlipH = document.getElementById("btnFlipH") as HTMLButtonElement;
export const btnFlipV = document.getElementById("btnFlipV") as HTMLButtonElement;
export const btnExportGds = document.getElementById("btnExportGds") as HTMLButtonElement;
export const btnExportSpice = document.getElementById("btnExportSpice") as HTMLButtonElement;
export const btnWireMode = document.getElementById("btnWireMode") as HTMLButtonElement;
export const btnExtPortMode = document.getElementById("btnExtPortMode") as HTMLButtonElement;
export const btnSourceMode = document.getElementById("btnSourceMode") as HTMLButtonElement;
export const wireLayerSelect = document.getElementById("wireLayerSelect") as HTMLSelectElement;
export const includeSelect = document.getElementById("includeSelect") as HTMLSelectElement;

// --- Camera (default zoom 200x so sub-micron devices are visible) ---

export const camera: Camera = { x: 0, y: 0, zoom: 200 };

// --- Mutable state (wrapped in object so cross-module mutation works) ---

export const S = {
  spaceHeld: false,
  isPanning: false,
  middlePanning: false,
  panStart: { x: 0, y: 0 },
  documentData: null as DocumentData | null,
  pdkCells: [] as PdkCellInfo[],
  selection: { type: "none", id: null } as SelectionState,
  isDragging: false,
  dragStartWorld: { x: 0, y: 0 },
  dragOrigPos: { x: 0, y: 0 },
  wireMode: false,
  wireDrawing: false,
  wireStartAnchor: null as WireAnchor | null,
  wirePreviewEnd: null as { x: number; y: number } | null,
  wireJunctionChain: [] as string[],
  wireLastClickTime: 0,
  externalPortMode: false,
  sourceMode: false,
};

// --- Caches ---

export const componentSizeCache = new Map<string, { xsize: number; ysize: number; ports: PdkPortInfo[] }>();
export const pendingQueries = new Set<string>();
export const includeGeometryCache = new Map<string, IncludeGeometry>();
export const pendingIncludeQueries = new Set<string>();

// --- Debounced save ---

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
export function saveDocument(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); }
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (S.documentData) {
      vscode.postMessage({ type: "edit", data: S.documentData });
    }
  }, 300);
}

// --- Helpers ---

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export function getSelectedComponent() {
  if (!S.documentData || S.selection.type !== "component" || !S.selection.id) { return null; }
  return S.documentData.components.find((c) => c.id === S.selection.id) ?? null;
}

export function getSelectedJunction() {
  if (!S.documentData || S.selection.type !== "junction" || !S.selection.id) { return null; }
  return S.documentData.junctions.find((j) => j.id === S.selection.id) ?? null;
}

export function getSelectedWire() {
  if (!S.documentData || S.selection.type !== "wire" || !S.selection.id) { return null; }
  return S.documentData.wires.find((w) => w.id === S.selection.id) ?? null;
}

export function getSelectedExternalPort() {
  if (!S.documentData || S.selection.type !== "externalPort" || !S.selection.id) { return null; }
  return S.documentData.externalPorts.find((ep) => ep.id === S.selection.id) ?? null;
}

export function getSelectedInclude() {
  if (!S.documentData || S.selection.type !== "include" || !S.selection.id) { return null; }
  return (S.documentData.includes ?? []).find((inc) => inc.id === S.selection.id) ?? null;
}

export function getSelectedSource() {
  if (!S.documentData || S.selection.type !== "source" || !S.selection.id) { return null; }
  return (S.documentData.sources ?? []).find((s) => s.id === S.selection.id) ?? null;
}

export function updateToolbarSelection(): void {
  const comp = getSelectedComponent();
  selectionToolbar.style.display = comp ? "flex" : "none";
}

export function clearSelection(): void {
  S.selection = { type: "none", id: null };
  updateToolbarSelection();
}

// --- Toast ---

let _toastText = "";
let _toastEnd = 0;

export function showToast(msg: string, durationMs = 1500): void {
  _toastText = msg;
  _toastEnd = performance.now() + durationMs;
}

export function drawToast(w: number, _h: number): void {
  if (!_toastText || performance.now() > _toastEnd) { return; }
  const remaining = _toastEnd - performance.now();
  const alpha = Math.min(1, remaining / 300);
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.font = "13px sans-serif";
  const metrics = ctx.measureText(_toastText);
  const pw = 12;
  const ph = 8;
  const bw = metrics.width + pw * 2;
  const bh = 20 + ph * 2;
  const bx = (w - bw) / 2;
  const by = 12;
  ctx.fillStyle = "#1e1e1e";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();
  ctx.fillStyle = "#e0e0e0";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(_toastText, w / 2, by + bh / 2);
  ctx.restore();
}
