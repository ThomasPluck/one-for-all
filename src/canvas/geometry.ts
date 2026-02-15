// Coordinate transforms, anchor resolution, and wire geometry helpers

import type { OfaComponent, PdkPortInfo } from "./types";
import { S, canvas, camera, componentSizeCache } from "./state";
import { getCellInfo, getDeviceSize } from "./pdk";

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.left - camera.x) / camera.zoom,
    y: (sy - rect.top - camera.y) / camera.zoom,
  };
}

export function transformPortToWorld(comp: OfaComponent, port: PdkPortInfo): { x: number; y: number } {
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

export function resolveAnchorPosition(id: string, type: "port" | "junction", componentId?: string): { x: number; y: number } | null {
  if (type === "junction") {
    const j = S.documentData?.junctions.find((jn) => jn.id === id);
    return j ? { x: j.x, y: j.y } : null;
  }
  if (!componentId || !S.documentData) { return null; }
  const comp = S.documentData.components.find((c) => c.id === componentId);
  if (!comp) { return null; }
  const cached = componentSizeCache.get(comp.id);
  const info = getCellInfo(comp.cell);
  const ports = cached ? cached.ports : (info ? info.ports : []);
  const port = ports.find((p) => p.name === id);
  if (!port) { return null; }
  return transformPortToWorld(comp, port);
}

export function snapWireEnd(startX: number, startY: number, mouseX: number, mouseY: number): { x: number; y: number } {
  const dx = Math.abs(mouseX - startX);
  const dy = Math.abs(mouseY - startY);
  if (dx >= dy) {
    return { x: Math.round(mouseX * 100) / 100, y: startY };
  } else {
    return { x: startX, y: Math.round(mouseY * 100) / 100 };
  }
}

export function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}
