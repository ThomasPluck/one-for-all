// PDK layer/color management and cell lookup

import type { OfaComponent, PdkCellInfo } from "./types";
import { S, componentSizeCache, wireLayerSelect } from "./state";

// --- Layer color map (populated from PDK — empty until pdkData arrives) ---

export const LAYER_COLORS: Record<string, string> = {};
export const GDS_LAYER_NAMES: Record<number, string> = {};

export function isViaLayer(name: string): boolean {
  return name.startsWith("Via") || name.startsWith("TopVia");
}

export function applyPdkLayers(layers: { name: string; gds_layer: [number, number]; color: string }[]): void {
  for (const layer of layers) {
    if (isViaLayer(layer.name)) { continue; }
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

export function layerColor(layer: [number, number] | null): string {
  if (!layer) { return "#888"; }
  const name = GDS_LAYER_NAMES[layer[0]];
  if (name && LAYER_COLORS[name]) { return LAYER_COLORS[name]; }
  return "#888";
}

export function layerName(layer: [number, number] | null): string {
  if (!layer) { return "Unknown"; }
  return GDS_LAYER_NAMES[layer[0]] || `Layer ${layer[0]}`;
}

export function getCellInfo(cellName: string): PdkCellInfo | undefined {
  return S.pdkCells.find((c) => c.name === cellName);
}

export function getDeviceSize(comp: OfaComponent): { w: number; h: number } {
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
