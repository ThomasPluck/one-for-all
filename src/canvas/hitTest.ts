// Hit testing for components, junctions, wires, and ports

import type { OfaComponent, OfaJunction, OfaWire, WireAnchor } from "./types";
import { S, JUNCTION_RADIUS, canvas, camera, componentSizeCache } from "./state";
import { getCellInfo, getDeviceSize } from "./pdk";
import { resolveAnchorPosition, transformPortToWorld, pointToSegmentDist } from "./geometry";

export function hitTestComponent(worldX: number, worldY: number): OfaComponent | null {
  if (!S.documentData) { return null; }
  for (let i = S.documentData.components.length - 1; i >= 0; i--) {
    const comp = S.documentData.components[i];
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

export function hitTestJunction(worldX: number, worldY: number): OfaJunction | null {
  if (!S.documentData) { return null; }
  const r = JUNCTION_RADIUS;
  for (let i = S.documentData.junctions.length - 1; i >= 0; i--) {
    const j = S.documentData.junctions[i];
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

export function hitTestWire(worldX: number, worldY: number): OfaWire | null {
  if (!S.documentData) { return null; }
  const threshold = Math.max(0.1, 5 / camera.zoom);
  for (let i = S.documentData.wires.length - 1; i >= 0; i--) {
    const wire = S.documentData.wires[i];
    const start = resolveAnchorPosition(wire.startId, wire.startType, wire.startComponentId);
    const end = resolveAnchorPosition(wire.endId, wire.endType, wire.endComponentId);
    if (!start || !end) { continue; }
    const dist = pointToSegmentDist(worldX, worldY, start.x, start.y, end.x, end.y);
    if (dist <= Math.max(wire.width / 2, threshold)) { return wire; }
  }
  return null;
}

export function hitTestPort(worldX: number, worldY: number): WireAnchor | null {
  if (!S.documentData) { return null; }
  for (const comp of S.documentData.components) {
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

export function updateHoverCursor(worldX: number, worldY: number): void {
  if (S.spaceHeld || S.wireMode) { return; }
  const j = hitTestJunction(worldX, worldY);
  if (j) { canvas.style.cursor = "pointer"; return; }
  const comp = hitTestComponent(worldX, worldY);
  if (comp) {
    canvas.style.cursor = S.selection.type === "component" && S.selection.id === comp.id ? "move" : "pointer";
    return;
  }
  const w = hitTestWire(worldX, worldY);
  if (w) {
    const wStart = resolveAnchorPosition(w.startId, w.startType, w.startComponentId);
    const wEnd = resolveAnchorPosition(w.endId, w.endType, w.endComponentId);
    if (wStart && wEnd) {
      const isH = Math.abs(wEnd.y - wStart.y) < 0.001;
      canvas.style.cursor = isH ? "ns-resize" : "ew-resize";
    } else {
      canvas.style.cursor = "pointer";
    }
    return;
  }
  canvas.style.cursor = "default";
}
