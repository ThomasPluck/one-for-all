// Mouse handlers, keyboard handlers, pan/zoom, wire drawing, component drag,
// wire drag, and toolbar button handlers

import type { OfaExternalPort, OfaInclude, OfaJunction, OfaWire, WireAnchor } from "./types";
import { S, canvas, camera, vscode, componentSizeCache, saveDocument, generateId, getSelectedComponent, getSelectedExternalPort, getSelectedInclude, getSelectedWire, updateToolbarSelection, clearSelection, btnRotate, btnFlipH, btnFlipV, btnExportGds, btnWireMode, btnExtPortMode, wireLayerSelect, componentSelect, includeSelect, includeGeometryCache, pendingIncludeQueries } from "./state";
import { getCellInfo, LAYER_COLORS } from "./pdk";
import { screenToWorld, snapWireEnd, resolveAnchorPosition } from "./geometry";
import { splitWireAtPoint, autoUpdateJunctionStyle, deleteComponentCascade, deleteExternalPortCascade, deleteIncludeCascade, deleteJunctionCascade, deleteWireCascade, getCollinearRun, classifyDirectionFromPoints, isDirectionAvailable, getOccupiedDirections } from "./junctions";
import { hitTestComponent, hitTestExternalPort, hitTestInclude, hitTestIncludePort, hitTestJunction, hitTestWire, hitTestPort, updateHoverCursor } from "./hitTest";
import { showParamOverlay, showExternalPortOverlay, showIncludeOverlay, showWireOverlay, closeParamOverlay, isParamOverlayOpen, isParamOverlayContaining } from "./overlays";

// --- Toolbar button handlers ---

export function initToolbar(): void {
  btnRotate.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.rotation = (comp.rotation + 90) % 360;
      saveDocument();
      return;
    }
    const inc = getSelectedInclude();
    if (inc) {
      inc.rotation = (inc.rotation + 90) % 360;
      saveDocument();
    }
  });

  btnFlipH.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.flipH = !(comp.flipH ?? false);
      saveDocument();
      return;
    }
    const inc = getSelectedInclude();
    if (inc) {
      inc.flipH = !(inc.flipH ?? false);
      saveDocument();
    }
  });

  btnFlipV.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.flipV = !(comp.flipV ?? false);
      saveDocument();
      return;
    }
    const inc = getSelectedInclude();
    if (inc) {
      inc.flipV = !(inc.flipV ?? false);
      saveDocument();
    }
  });

  btnExportGds.addEventListener("click", () => {
    btnExportGds.disabled = true;
    btnExportGds.textContent = "Exporting...";
    vscode.postMessage({ type: "exportGds" });
  });

  btnWireMode.addEventListener("click", () => {
    S.wireMode = !S.wireMode;
    S.externalPortMode = false;
    btnWireMode.classList.toggle("active", S.wireMode);
    btnExtPortMode.classList.remove("active");
    if (!S.wireMode) {
      terminateWireDrawing();
    }
    canvas.style.cursor = S.wireMode ? "crosshair" : "default";
  });

  btnExtPortMode.addEventListener("click", () => {
    S.externalPortMode = !S.externalPortMode;
    S.wireMode = false;
    terminateWireDrawing();
    btnExtPortMode.classList.toggle("active", S.externalPortMode);
    btnWireMode.classList.remove("active");
    canvas.style.cursor = S.externalPortMode ? "crosshair" : "default";
  });
}

// --- Wire drawing helpers ---

function addIntermediateJunction(rawClickPos: { x: number; y: number }): void {
  if (!S.documentData || !S.wireStartAnchor) { return; }

  const startX = S.wireStartAnchor.x;
  const startY = S.wireStartAnchor.y;
  const snapped = snapWireEnd(startX, startY, rawClickPos.x, rawClickPos.y);

  // Don't create zero-length wire
  if (Math.abs(snapped.x - startX) < 0.01 && Math.abs(snapped.y - startY) < 0.01) { return; }

  // Check reserved direction at start anchor
  if (S.wireStartAnchor.type === "junction") {
    const dir = classifyDirectionFromPoints(startX, startY, snapped.x, snapped.y);
    if (!isDirectionAvailable(S.wireStartAnchor.id, dir)) { return; }
  }

  const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
  S.documentData.junctions.push(newJ);

  const newWire: OfaWire = {
    id: generateId(),
    layer: wireLayerSelect.value,
    width: 0.1,
    startId: S.wireStartAnchor.id,
    startType: S.wireStartAnchor.type,
    startComponentId: S.wireStartAnchor.componentId,
    endId: newJ.id,
    endType: "junction",
  };
  S.documentData.wires.push(newWire);

  if (S.wireStartAnchor.type === "junction") { autoUpdateJunctionStyle(S.wireStartAnchor.id); }
  autoUpdateJunctionStyle(newJ.id);

  S.wireStartAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
  S.wireJunctionChain.push(newJ.id);
  saveDocument();
}

function fallbackSRoute(startAnchor: WireAnchor, endAnchor: WireAnchor): void {
  if (!S.documentData) { return; }

  const sx = startAnchor.x, sy = startAnchor.y;
  const ex = endAnchor.x, ey = endAnchor.y;

  let j1: OfaJunction, j2: OfaJunction;
  if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
    // Wider than tall: horizontal → vertical → horizontal (midX)
    const midX = Math.round((sx + ex) / 2 * 100) / 100;
    j1 = { id: generateId(), x: midX, y: sy, style: "d2" };
    j2 = { id: generateId(), x: midX, y: ey, style: "d2" };
  } else {
    // Taller than wide: vertical → horizontal → vertical (midY)
    const midY = Math.round((sy + ey) / 2 * 100) / 100;
    j1 = { id: generateId(), x: sx, y: midY, style: "d2" };
    j2 = { id: generateId(), x: ex, y: midY, style: "d2" };
  }
  S.documentData.junctions.push(j1, j2);

  const layer = wireLayerSelect.value;
  const w1: OfaWire = {
    id: generateId(), layer, width: 0.1,
    startId: startAnchor.id, startType: startAnchor.type, startComponentId: startAnchor.componentId,
    endId: j1.id, endType: "junction",
  };
  const w2: OfaWire = {
    id: generateId(), layer, width: 0.1,
    startId: j1.id, startType: "junction",
    endId: j2.id, endType: "junction",
  };
  const w3: OfaWire = {
    id: generateId(), layer, width: 0.1,
    startId: j2.id, startType: "junction",
    endId: endAnchor.id, endType: endAnchor.type, endComponentId: endAnchor.componentId,
  };
  S.documentData.wires.push(w1, w2, w3);

  if (startAnchor.type === "junction") { autoUpdateJunctionStyle(startAnchor.id); }
  autoUpdateJunctionStyle(j1.id);
  autoUpdateJunctionStyle(j2.id);
  if (endAnchor.type === "junction") { autoUpdateJunctionStyle(endAnchor.id); }
}

function tryMoveJunctionToAlign(junctionId: string, targetX: number, targetY: number): boolean {
  if (!S.documentData) return false;
  const junction = S.documentData.junctions.find(j => j.id === junctionId);
  if (!junction) return false;

  const wires = S.documentData.wires.filter(w =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );

  for (const wire of wires) {
    const wStart = resolveAnchorPosition(wire.startId, wire.startType, wire.startComponentId);
    const wEnd = resolveAnchorPosition(wire.endId, wire.endType, wire.endComponentId);
    if (!wStart || !wEnd) continue;

    const isH = Math.abs(wEnd.y - wStart.y) < 0.001;
    const neededDelta = isH ? (targetY - junction.y) : (targetX - junction.x);
    if (Math.abs(neededDelta) < 0.01) continue;

    const run = getCollinearRun(wire);
    if (run.junctions.length === 0) continue;

    let minDelta = -Infinity, maxDelta = +Infinity;
    for (const j of run.junctions) {
      const jWires = S.documentData.wires.filter(cw =>
        (cw.startType === "junction" && cw.startId === j.id) ||
        (cw.endType === "junction" && cw.endId === j.id)
      );
      for (const cw of jWires) {
        const cwIsStart = cw.startType === "junction" && cw.startId === j.id;
        const nPos = resolveAnchorPosition(
          cwIsStart ? cw.endId : cw.startId,
          cwIsStart ? cw.endType : cw.startType,
          cwIsStart ? cw.endComponentId : cw.startComponentId,
        );
        if (!nPos) continue;
        if (isH) {
          if (Math.abs(nPos.x - j.x) < 0.01) {
            if (nPos.y > j.y) maxDelta = Math.min(maxDelta, nPos.y - j.y - 0.01);
            else minDelta = Math.max(minDelta, nPos.y - j.y + 0.01);
          }
        } else {
          if (Math.abs(nPos.y - j.y) < 0.01) {
            if (nPos.x > j.x) maxDelta = Math.min(maxDelta, nPos.x - j.x - 0.01);
            else minDelta = Math.max(minDelta, nPos.x - j.x + 0.01);
          }
        }
      }
    }
    if (minDelta > maxDelta) continue;
    const clamped = Math.max(minDelta, Math.min(maxDelta, neededDelta));

    const achieves = isH
      ? Math.abs((junction.y + clamped) - targetY) < 0.01
      : Math.abs((junction.x + clamped) - targetX) < 0.01;
    if (!achieves) continue;

    for (const j of run.junctions) {
      if (isH) j.y = Math.round((j.y + clamped) * 100) / 100;
      else j.x = Math.round((j.x + clamped) * 100) / 100;
    }
    for (const id of run.allTouchedIds) { autoUpdateJunctionStyle(id); }
    return true;
  }
  return false;
}

function completeWireToJunction(endAnchor: WireAnchor): void {
  if (!S.documentData || !S.wireStartAnchor) { return; }
  if (S.wireStartAnchor.id === endAnchor.id && S.wireStartAnchor.type === endAnchor.type) { return; }

  // Hard reject: all 4 directions occupied on target
  if (endAnchor.type === "junction") {
    if (getOccupiedDirections(endAnchor.id).size >= 4) { return; }
  }

  let connected = false;

  // Helper: check aligned + direction available, then create wire
  const tryDirectWire = (): boolean => {
    const aligned = Math.abs(endAnchor.x - S.wireStartAnchor!.x) < 0.01
                  || Math.abs(endAnchor.y - S.wireStartAnchor!.y) < 0.01;
    if (!aligned) { return false; }
    if (S.wireStartAnchor!.type === "junction") {
      const d = classifyDirectionFromPoints(S.wireStartAnchor!.x, S.wireStartAnchor!.y, endAnchor.x, endAnchor.y);
      if (!isDirectionAvailable(S.wireStartAnchor!.id, d)) { return false; }
    }
    if (endAnchor.type === "junction") {
      const d = classifyDirectionFromPoints(endAnchor.x, endAnchor.y, S.wireStartAnchor!.x, S.wireStartAnchor!.y);
      if (!isDirectionAvailable(endAnchor.id, d)) { return false; }
    }
    S.documentData!.wires.push({
      id: generateId(), layer: wireLayerSelect.value, width: 0.1,
      startId: S.wireStartAnchor!.id, startType: S.wireStartAnchor!.type,
      startComponentId: S.wireStartAnchor!.componentId,
      endId: endAnchor.id, endType: endAnchor.type, endComponentId: endAnchor.componentId,
    });
    return true;
  };

  // Step 1: Try direct wire (already aligned + direction available)
  connected = tryDirectWire();

  // Step 2: Snap last chain junction along its segment (extends length, always geometrically legal)
  if (!connected && S.wireJunctionChain.length >= 2) {
    const lastJId = S.wireJunctionChain[S.wireJunctionChain.length - 1];
    const secId = S.wireJunctionChain[S.wireJunctionChain.length - 2];
    const lastJ = S.documentData.junctions.find(j => j.id === lastJId);
    const secJ = S.documentData.junctions.find(j => j.id === secId);
    if (lastJ && secJ) {
      const origX = lastJ.x, origY = lastJ.y;
      const segH = Math.abs(lastJ.x - secJ.x) > Math.abs(lastJ.y - secJ.y);
      if (segH) { lastJ.x = endAnchor.x; } else { lastJ.y = endAnchor.y; }
      S.wireStartAnchor.x = lastJ.x;
      S.wireStartAnchor.y = lastJ.y;
      autoUpdateJunctionStyle(lastJId);
      autoUpdateJunctionStyle(secId);
      connected = tryDirectWire();
      if (!connected) {
        lastJ.x = origX; lastJ.y = origY;
        S.wireStartAnchor.x = origX; S.wireStartAnchor.y = origY;
        autoUpdateJunctionStyle(lastJId);
        autoUpdateJunctionStyle(secId);
      }
    }
  }

  // Step 3: Move connecting junction via collinear chain drag
  if (!connected && S.wireStartAnchor.type === "junction") {
    if (tryMoveJunctionToAlign(S.wireStartAnchor.id, endAnchor.x, endAnchor.y)) {
      const j = S.documentData.junctions.find(jn => jn.id === S.wireStartAnchor!.id);
      if (j) { S.wireStartAnchor.x = j.x; S.wireStartAnchor.y = j.y; }
      connected = tryDirectWire();
    }
  }

  // Step 4: Move target junction via collinear chain drag
  if (!connected && endAnchor.type === "junction") {
    if (tryMoveJunctionToAlign(endAnchor.id, S.wireStartAnchor.x, S.wireStartAnchor.y)) {
      const j = S.documentData.junctions.find(jn => jn.id === endAnchor.id);
      if (j) { endAnchor.x = j.x; endAnchor.y = j.y; }
      connected = tryDirectWire();
    }
  }

  // Step 5: S-route fallback (zig-zag at midpoint)
  if (!connected) {
    fallbackSRoute(S.wireStartAnchor, endAnchor);
  }

  if (S.wireStartAnchor.type === "junction") { autoUpdateJunctionStyle(S.wireStartAnchor.id); }
  if (endAnchor.type === "junction") { autoUpdateJunctionStyle(endAnchor.id); }

  saveDocument();
  S.wireDrawing = false;
  S.wireStartAnchor = null;
  S.wirePreviewEnd = null;
  S.wireJunctionChain = [];
  S.wireLastClickTime = 0;
}

function completeWireToPort(portAnchor: WireAnchor): void {
  if (!S.documentData || !S.wireStartAnchor) { return; }

  // Self-connection guard
  if ((S.wireStartAnchor.type === "port" || S.wireStartAnchor.type === "includePort") &&
      S.wireStartAnchor.id === portAnchor.id &&
      S.wireStartAnchor.componentId === portAnchor.componentId) {
    return;
  }

  const startX = S.wireStartAnchor.x;
  const startY = S.wireStartAnchor.y;
  const portX = portAnchor.x;
  const portY = portAnchor.y;
  const dx = Math.abs(portX - startX);
  const dy = Math.abs(portY - startY);
  const isAligned = dx < 0.01 || dy < 0.01;

  if (isAligned) {
    // Direct manhattan connection to port
    const newWire: OfaWire = {
      id: generateId(),
      layer: wireLayerSelect.value,
      width: 0.1,
      startId: S.wireStartAnchor.id,
      startType: S.wireStartAnchor.type,
      startComponentId: S.wireStartAnchor.componentId,
      endId: portAnchor.id,
      endType: portAnchor.type,
      endComponentId: portAnchor.componentId,
    };
    S.documentData.wires.push(newWire);
    if (S.wireStartAnchor.type === "junction") { autoUpdateJunctionStyle(S.wireStartAnchor.id); }
  } else {
    // Not aligned — snap last placed junction to create manhattan path to port
    const chainLen = S.wireJunctionChain.length;

    if (chainLen >= 2) {
      // Snap last junction to be inline with port + second-last junction
      const lastJId = S.wireJunctionChain[chainLen - 1];
      const secondLastJId = S.wireJunctionChain[chainLen - 2];
      const lastJ = S.documentData.junctions.find((j) => j.id === lastJId);
      const secondLastJ = S.documentData.junctions.find((j) => j.id === secondLastJId);

      if (lastJ && secondLastJ) {
        const segDx = Math.abs(lastJ.x - secondLastJ.x);
        const segDy = Math.abs(lastJ.y - secondLastJ.y);

        if (segDx > segDy) {
          // second-last → last was horizontal (same Y) → make last→port vertical
          lastJ.x = portX;
        } else {
          // second-last → last was vertical (same X) → make last→port horizontal
          lastJ.y = portY;
        }

        const newWire: OfaWire = {
          id: generateId(),
          layer: wireLayerSelect.value,
          width: 0.1,
          startId: lastJ.id,
          startType: "junction",
          endId: portAnchor.id,
          endType: portAnchor.type,
          endComponentId: portAnchor.componentId,
        };
        S.documentData.wires.push(newWire);
        autoUpdateJunctionStyle(lastJ.id);
        autoUpdateJunctionStyle(secondLastJId);
      }
    } else {
      // No second-last junction — fall back to S manhattan route
      fallbackSRoute(S.wireStartAnchor, portAnchor);
    }
  }

  saveDocument();
  S.wireDrawing = false;
  S.wireStartAnchor = null;
  S.wirePreviewEnd = null;
  S.wireJunctionChain = [];
  S.wireLastClickTime = 0;
}

function terminateWireDrawing(): void {
  S.wireDrawing = false;
  S.wireStartAnchor = null;
  S.wirePreviewEnd = null;
  S.wireJunctionChain = [];
  S.wireLastClickTime = 0;
}

// --- Event listeners ---

export function initEventListeners(): void {
  // --- Right-click context menu ---
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    if (S.wireDrawing) {
      terminateWireDrawing();
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    const epHit = hitTestExternalPort(world.x, world.y);
    if (epHit) {
      showExternalPortOverlay(epHit, e.clientX, e.clientY);
      return;
    }

    const incHit = hitTestInclude(world.x, world.y);
    if (incHit) {
      showIncludeOverlay(incHit, e.clientX, e.clientY);
      return;
    }

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
    if (isParamOverlayOpen() && !isParamOverlayContaining(e.target as Node)) {
      closeParamOverlay();
    }
  });

  // --- Keyboard ---

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      S.spaceHeld = true;
      canvas.style.cursor = "grab";
      e.preventDefault();
      return;
    }

    if (isParamOverlayOpen()) { return; }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { return; }

    if (e.key === "Escape") {
      if (S.wireDrawing) {
        terminateWireDrawing();
        e.preventDefault();
        return;
      }
      if (S.wireMode) {
        S.wireMode = false;
        btnWireMode.classList.remove("active");
        canvas.style.cursor = "default";
        e.preventDefault();
        return;
      }
      if (S.externalPortMode) {
        S.externalPortMode = false;
        btnExtPortMode.classList.remove("active");
        canvas.style.cursor = "default";
        e.preventDefault();
        return;
      }
    }

    if (e.key === "w" || e.key === "W") {
      btnWireMode.click();
      e.preventDefault();
      return;
    }

    if (e.key === "e" || e.key === "E") {
      btnExtPortMode.click();
      e.preventDefault();
      return;
    }

    const comp = getSelectedComponent();
    if (comp) {
      if (e.key === "r" || e.key === "R") {
        comp.rotation = (comp.rotation + 90) % 360;
        saveDocument();
        e.preventDefault();
      }
      if (e.key === "h" || e.key === "H") {
        comp.flipH = !(comp.flipH ?? false);
        saveDocument();
        e.preventDefault();
      }
      if (e.key === "v" || e.key === "V") {
        comp.flipV = !(comp.flipV ?? false);
        saveDocument();
        e.preventDefault();
      }
    }

    const inc = getSelectedInclude();
    if (inc) {
      if (e.key === "r" || e.key === "R") {
        inc.rotation = (inc.rotation + 90) % 360;
        saveDocument();
        e.preventDefault();
      }
      if (e.key === "h" || e.key === "H") {
        inc.flipH = !(inc.flipH ?? false);
        saveDocument();
        e.preventDefault();
      }
      if (e.key === "v" || e.key === "V") {
        inc.flipV = !(inc.flipV ?? false);
        saveDocument();
        e.preventDefault();
      }
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (!S.documentData) { return; }
      if (S.selection.type === "component" && S.selection.id) {
        deleteComponentCascade(S.selection.id);
        clearSelection();
        saveDocument();
        e.preventDefault();
      } else if (S.selection.type === "junction" && S.selection.id) {
        deleteJunctionCascade(S.selection.id);
        clearSelection();
        saveDocument();
        e.preventDefault();
      } else if (S.selection.type === "wire" && S.selection.id) {
        deleteWireCascade(S.selection.id);
        clearSelection();
        saveDocument();
        e.preventDefault();
      } else if (S.selection.type === "externalPort" && S.selection.id) {
        deleteExternalPortCascade(S.selection.id);
        clearSelection();
        saveDocument();
        e.preventDefault();
      } else if (S.selection.type === "include" && S.selection.id) {
        deleteIncludeCascade(S.selection.id);
        clearSelection();
        saveDocument();
        e.preventDefault();
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      S.spaceHeld = false;
      S.isPanning = false;
      canvas.style.cursor = S.wireMode ? "crosshair" : "default";
    }
  });

  // --- Mouse down ---

  canvas.addEventListener("mousedown", (e) => {
    // Middle click pan
    if (e.button === 1) {
      e.preventDefault();
      S.middlePanning = true;
      S.panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
      canvas.style.cursor = "grabbing";
      return;
    }
    // Space + left click pan
    if (S.spaceHeld && e.button === 0) {
      S.isPanning = true;
      S.panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
      canvas.style.cursor = "grabbing";
      return;
    }
    // Left click
    if (e.button === 0 && !S.spaceHeld) {
      const world = screenToWorld(e.clientX, e.clientY);

      // --- WIRE MODE ---
      if (S.wireMode && S.documentData) {
        if (!S.wireDrawing) {
          // === START WIRE DRAWING ===
          const portHit = hitTestPort(world.x, world.y);
          if (portHit) {
            S.wireStartAnchor = portHit;
            S.wireDrawing = true;
            S.wireJunctionChain = [];
            return;
          }
          const jHit = hitTestJunction(world.x, world.y);
          if (jHit) {
            S.wireStartAnchor = { type: "junction", id: jHit.id, x: jHit.x, y: jHit.y };
            S.wireDrawing = true;
            S.wireJunctionChain = [jHit.id];
            return;
          }
          const epStart = hitTestExternalPort(world.x, world.y);
          if (epStart) {
            S.wireStartAnchor = { type: "externalPort", id: epStart.id, x: epStart.x, y: epStart.y };
            S.wireDrawing = true;
            S.wireJunctionChain = [];
            return;
          }
          const ipStart = hitTestIncludePort(world.x, world.y);
          if (ipStart) {
            S.wireStartAnchor = ipStart;
            S.wireDrawing = true;
            S.wireJunctionChain = [];
            return;
          }
          const wireHit = hitTestWire(world.x, world.y);
          if (wireHit) {
            const splitJ = splitWireAtPoint(wireHit, world.x, world.y);
            if (splitJ) {
              S.wireStartAnchor = { type: "junction", id: splitJ.id, x: splitJ.x, y: splitJ.y };
              S.wireDrawing = true;
              S.wireJunctionChain = [splitJ.id];
              saveDocument();
              return;
            }
          }
          const snapped = { x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 };
          const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
          S.documentData.junctions.push(newJ);
          S.wireStartAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
          S.wireDrawing = true;
          S.wireJunctionChain = [newJ.id];
          saveDocument();
          return;
        } else {
          // === CONTINUE / TERMINATE WIRE DRAWING ===
          const rawEnd = { x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 };

          // Port hit → always terminate
          const portHit = hitTestPort(rawEnd.x, rawEnd.y);
          if (portHit) {
            completeWireToPort(portHit);
            return;
          }

          // Junction hit → always terminate
          const jHit = hitTestJunction(rawEnd.x, rawEnd.y);
          if (jHit) {
            completeWireToJunction({ type: "junction", id: jHit.id, x: jHit.x, y: jHit.y });
            return;
          }

          // External port hit → always terminate
          const epEnd = hitTestExternalPort(rawEnd.x, rawEnd.y);
          if (epEnd) {
            completeWireToJunction({ type: "externalPort", id: epEnd.id, x: epEnd.x, y: epEnd.y });
            return;
          }

          // Include port hit → terminate (use port completion for alignment/S-routing)
          const ipEnd = hitTestIncludePort(rawEnd.x, rawEnd.y);
          if (ipEnd) {
            completeWireToPort(ipEnd);
            return;
          }

          // Wire hit → split + terminate (snap-to-target like port termination)
          const wireHit = hitTestWire(rawEnd.x, rawEnd.y);
          if (wireHit) {
            const splitJ = splitWireAtPoint(wireHit, rawEnd.x, rawEnd.y);
            if (splitJ) {
              const splitAnchor = { type: "junction" as const, id: splitJ.id, x: splitJ.x, y: splitJ.y };
              const sX = S.wireStartAnchor!.x;
              const sY = S.wireStartAnchor!.y;
              const aligned = Math.abs(splitJ.x - sX) < 0.01 || Math.abs(splitJ.y - sY) < 0.01;

              if (aligned) {
                completeWireToJunction(splitAnchor);
              } else if (S.wireJunctionChain.length >= 2) {
                // Snap last chain junction to align with splitJ (same as port termination)
                const lastJId = S.wireJunctionChain[S.wireJunctionChain.length - 1];
                const secondLastJId = S.wireJunctionChain[S.wireJunctionChain.length - 2];
                const lastJ = S.documentData.junctions.find(j => j.id === lastJId);
                const secondLastJ = S.documentData.junctions.find(j => j.id === secondLastJId);
                if (lastJ && secondLastJ) {
                  const segDx = Math.abs(lastJ.x - secondLastJ.x);
                  const segDy = Math.abs(lastJ.y - secondLastJ.y);
                  if (segDx > segDy) { lastJ.x = splitJ.x; }
                  else { lastJ.y = splitJ.y; }
                  completeWireToJunction(splitAnchor);
                }
              } else {
                fallbackSRoute(S.wireStartAnchor!, splitAnchor);
                terminateWireDrawing();
                saveDocument();
              }
              return;
            }
          }

          // Empty space → add intermediate junction, continue drawing
          // Double-click guard: skip if this is the second click of a double-click
          const now = Date.now();
          if (now - S.wireLastClickTime < 300) { return; }
          S.wireLastClickTime = now;
          addIntermediateJunction(rawEnd);
          return;
        }
      }

      // --- EXTERNAL PORT PLACEMENT MODE ---
      if (S.externalPortMode && S.documentData) {
        const nextIdx = S.documentData.externalPorts.length + 1;
        const newPort: OfaExternalPort = {
          id: generateId(),
          name: `PORT_${nextIdx}`,
          x: Math.round(world.x * 100) / 100,
          y: Math.round(world.y * 100) / 100,
          layer: wireLayerSelect.value || Object.keys(LAYER_COLORS)[0] || "Metal1",
          width: 0.1,
        };
        S.documentData.externalPorts.push(newPort);
        S.selection = { type: "externalPort", id: newPort.id };
        S.externalPortMode = false;
        btnExtPortMode.classList.remove("active");
        canvas.style.cursor = "default";
        saveDocument();
        updateToolbarSelection();
        return;
      }

      // --- NORMAL MODE ---

      const jHit = hitTestJunction(world.x, world.y);
      if (jHit) {
        S.selection = { type: "junction", id: jHit.id };
        updateToolbarSelection();
        return;
      }

      const epNormalHit = hitTestExternalPort(world.x, world.y);
      if (epNormalHit) {
        S.selection = { type: "externalPort", id: epNormalHit.id };
        S.isDragging = true;
        S.dragStartWorld = { x: world.x, y: world.y };
        S.dragOrigPos = { x: epNormalHit.x, y: epNormalHit.y };
        canvas.style.cursor = "move";
        updateToolbarSelection();
        return;
      }

      const incNormalHit = hitTestInclude(world.x, world.y);
      if (incNormalHit) {
        S.selection = { type: "include", id: incNormalHit.id };
        S.isDragging = true;
        S.dragStartWorld = { x: world.x, y: world.y };
        S.dragOrigPos = { x: incNormalHit.x, y: incNormalHit.y };
        canvas.style.cursor = "move";
        updateToolbarSelection();
        return;
      }

      const hitComp = hitTestComponent(world.x, world.y);
      if (hitComp) {
        S.selection = { type: "component", id: hitComp.id };
        S.isDragging = true;
        S.dragStartWorld = { x: world.x, y: world.y };
        S.dragOrigPos = { x: hitComp.x, y: hitComp.y };
        canvas.style.cursor = "move";
        updateToolbarSelection();
        return;
      }

      const wHit = hitTestWire(world.x, world.y);
      if (wHit) {
        S.selection = { type: "wire", id: wHit.id };
        S.isDragging = true;
        S.dragStartWorld = { x: world.x, y: world.y };
        canvas.style.cursor = "move";
        updateToolbarSelection();
        return;
      }

      // Empty space + include dropdown selected → place new include
      const selectedIncFile = includeSelect.value;
      if (selectedIncFile && S.documentData) {
        const newInc: OfaInclude = {
          id: generateId(),
          file: selectedIncFile,
          x: Math.round(world.x * 100) / 100,
          y: Math.round(world.y * 100) / 100,
          rotation: 0,
        };
        if (!S.documentData.includes) { S.documentData.includes = []; }
        S.documentData.includes.push(newInc);
        S.selection = { type: "include", id: newInc.id };
        // Request geometry for the newly placed include
        if (!includeGeometryCache.has(newInc.id) && !pendingIncludeQueries.has(newInc.id)) {
          pendingIncludeQueries.add(newInc.id);
          vscode.postMessage({ type: "queryIncludeGeometry", includeId: newInc.id, file: newInc.file });
        }
        includeSelect.value = "";
        saveDocument();
        updateToolbarSelection();
        return;
      }

      // Empty space + dropdown selected → place new component
      const selectedCell = componentSelect.value;
      if (selectedCell && S.documentData) {
        const info = getCellInfo(selectedCell);
        const defaultParams: Record<string, number | string | boolean> = {};
        if (info) {
          for (const [k, v] of Object.entries(info.params)) {
            if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
              defaultParams[k] = v;
            }
          }
        }
        const newComp = {
          id: generateId(),
          cell: selectedCell,
          x: Math.round(world.x * 100) / 100,
          y: Math.round(world.y * 100) / 100,
          rotation: 0,
          params: defaultParams,
        };
        if (info) {
          componentSizeCache.set(newComp.id, { xsize: info.xsize, ysize: info.ysize, ports: info.ports });
        }
        S.documentData.components.push(newComp);
        S.selection = { type: "component", id: newComp.id };
        saveDocument();
        updateToolbarSelection();
      } else {
        clearSelection();
      }
    }
  });

  // --- Mouse move ---

  canvas.addEventListener("mousemove", (e) => {
    if (S.isPanning || S.middlePanning) {
      camera.x = e.clientX - S.panStart.x;
      camera.y = e.clientY - S.panStart.y;
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    if (S.wireDrawing && S.wireStartAnchor) {
      S.wirePreviewEnd = { x: world.x, y: world.y };
      return;
    }

    if (S.isDragging) {
      if (S.selection.type === "component") {
        const comp = getSelectedComponent();
        if (comp) {
          const dx = world.x - S.dragStartWorld.x;
          const dy = world.y - S.dragStartWorld.y;
          comp.x = Math.round((S.dragOrigPos.x + dx) * 100) / 100;
          comp.y = Math.round((S.dragOrigPos.y + dy) * 100) / 100;
        }
      } else if (S.selection.type === "externalPort") {
        const ep = getSelectedExternalPort();
        if (ep) {
          const dx = world.x - S.dragStartWorld.x;
          const dy = world.y - S.dragStartWorld.y;
          ep.x = Math.round((S.dragOrigPos.x + dx) * 100) / 100;
          ep.y = Math.round((S.dragOrigPos.y + dy) * 100) / 100;
        }
      } else if (S.selection.type === "include") {
        const inc = getSelectedInclude();
        if (inc) {
          const dx = world.x - S.dragStartWorld.x;
          const dy = world.y - S.dragStartWorld.y;
          inc.x = Math.round((S.dragOrigPos.x + dx) * 100) / 100;
          inc.y = Math.round((S.dragOrigPos.y + dy) * 100) / 100;
        }
      } else if (S.selection.type === "wire") {
        const w = getSelectedWire();
        if (w) {
          const start = resolveAnchorPosition(w.startId, w.startType, w.startComponentId);
          const end = resolveAnchorPosition(w.endId, w.endType, w.endComponentId);
          if (start && end) {
            const isH = Math.abs(end.y - start.y) < 0.001;
            const dx = world.x - S.dragStartWorld.x;
            const dy = world.y - S.dragStartWorld.y;
            const run = getCollinearRun(w);

            // Pass 1: compute the tightest allowed delta across ALL chain junctions
            let minDelta = -Infinity;
            let maxDelta = +Infinity;
            const rawDelta = isH ? dy : dx;

            for (const j of run.junctions) {
              const jWires = S.documentData!.wires.filter((cw) =>
                (cw.startType === "junction" && cw.startId === j.id) ||
                (cw.endType === "junction" && cw.endId === j.id)
              );
              for (const cw of jWires) {
                const cwIsStart = cw.startType === "junction" && cw.startId === j.id;
                const nPos = resolveAnchorPosition(
                  cwIsStart ? cw.endId : cw.startId,
                  cwIsStart ? cw.endType : cw.startType,
                  cwIsStart ? cw.endComponentId : cw.startComponentId,
                );
                if (!nPos) { continue; }
                if (isH) {
                  // Vertical perpendicular neighbor (same X)
                  if (Math.abs(nPos.x - j.x) < 0.01) {
                    if (nPos.y > j.y) { maxDelta = Math.min(maxDelta, nPos.y - j.y - 0.01); }
                    else { minDelta = Math.max(minDelta, nPos.y - j.y + 0.01); }
                  }
                } else {
                  // Horizontal perpendicular neighbor (same Y)
                  if (Math.abs(nPos.y - j.y) < 0.01) {
                    if (nPos.x > j.x) { maxDelta = Math.min(maxDelta, nPos.x - j.x - 0.01); }
                    else { minDelta = Math.max(minDelta, nPos.x - j.x + 0.01); }
                  }
                }
              }
            }

            // Resolve: clamp rawDelta into [minDelta, maxDelta], or 0 if boxed in
            const clampedDelta = (minDelta > maxDelta) ? 0
              : Math.max(minDelta, Math.min(maxDelta, rawDelta));

            // Pass 2: apply uniform delta to all junctions
            for (const j of run.junctions) {
              if (isH) { j.y = Math.round((j.y + clampedDelta) * 100) / 100; }
              else { j.x = Math.round((j.x + clampedDelta) * 100) / 100; }
            }

            S.dragStartWorld = { x: world.x, y: world.y };
          }
        }
      }
      return;
    }

    updateHoverCursor(world.x, world.y);
  });

  // --- Mouse up ---

  canvas.addEventListener("mouseup", (e) => {
    if (S.middlePanning && e.button === 1) {
      S.middlePanning = false;
      canvas.style.cursor = S.wireMode ? "crosshair" : "default";
    }
    if (S.isPanning && e.button === 0) {
      S.isPanning = false;
      canvas.style.cursor = S.spaceHeld ? "grab" : (S.wireMode ? "crosshair" : "default");
    }
    if (S.isDragging && e.button === 0) {
      S.isDragging = false;
      canvas.style.cursor = S.wireMode ? "crosshair" : "default";
      if (S.documentData) {
        if (S.selection.type === "wire") {
          const w = getSelectedWire();
          if (w) {
            const run = getCollinearRun(w);
            for (const id of run.allTouchedIds) {
              autoUpdateJunctionStyle(id);
            }
          }
        }
        saveDocument();
      }
    }
  });

  // --- Double-click: terminate wire drawing ---
  canvas.addEventListener("dblclick", (e) => {
    if (!S.wireDrawing || !S.wireMode || !S.documentData) { return; }
    e.preventDefault();
    // First click of dblclick already placed an intermediate junction.
    // Just terminate drawing, leaving last junction unterminated.
    terminateWireDrawing();
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
}
