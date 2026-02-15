// All draw/render functions: grid, origin, wires, junctions, components,
// selection, legend, scale bar, canvas resize, and the render loop

import type { OfaComponent } from "./types";
import { S, JUNCTION_RADIUS, canvas, ctx, camera, componentSizeCache, wireLayerSelect, getSelectedComponent, getSelectedJunction, getSelectedWire } from "./state";
import { LAYER_COLORS, getCellInfo, getDeviceSize, layerColor } from "./pdk";
import { resolveAnchorPosition, snapWireEnd } from "./geometry";
import { computeJunctionColors } from "./junctions";

// --- Canvas resize ---

export function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

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
  if (!S.documentData) { return; }

  for (const wire of S.documentData.wires) {
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
  if (S.wireDrawing && S.wireStartAnchor && S.wirePreviewEnd) {
    const color = LAYER_COLORS[wireLayerSelect.value] || "#888";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.1;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([0.1, 0.05]);

    const sx = S.wireStartAnchor.x, sy = S.wireStartAnchor.y;
    const ex = S.wirePreviewEnd.x, ey = S.wirePreviewEnd.y;
    const adx = Math.abs(ex - sx), ady = Math.abs(ey - sy);
    const maxD = Math.max(adx, ady), minD = Math.min(adx, ady);
    const isNearlyHV = minD < 0.05 || (maxD > 0 && minD / maxD < 0.33);

    ctx.beginPath();
    if (isNearlyHV) {
      const snapped = snapWireEnd(sx, sy, ex, ey);
      ctx.moveTo(sx, sy);
      ctx.lineTo(snapped.x, snapped.y);
    } else {
      // Z-route preview: H → V → H
      const midX = (sx + ex) / 2;
      ctx.moveTo(sx, sy);
      ctx.lineTo(midX, sy);
      ctx.lineTo(midX, ey);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// --- Junction rendering ---

function drawJunctions(): void {
  if (!S.documentData) { return; }

  for (const junction of S.documentData.junctions) {
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
  if (!S.documentData) { return; }

  for (const comp of S.documentData.components) {
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
  if (S.selection.type === "component") {
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
  } else if (S.selection.type === "junction") {
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
  } else if (S.selection.type === "wire") {
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

export function render(): void {
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
