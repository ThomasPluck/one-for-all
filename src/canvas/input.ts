// Mouse handlers, keyboard handlers, pan/zoom, wire drawing, component drag,
// wire drag, and toolbar button handlers

import type { OfaJunction, OfaWire, WireAnchor } from "./types";
import { S, canvas, camera, vscode, componentSizeCache, saveDocument, generateId, getSelectedComponent, getSelectedWire, updateToolbarSelection, clearSelection, btnRotate, btnFlipH, btnFlipV, btnExportGds, btnWireMode, wireLayerSelect, componentSelect } from "./state";
import { getCellInfo } from "./pdk";
import { screenToWorld, snapWireEnd, resolveAnchorPosition } from "./geometry";
import { splitWireAtPoint, autoUpdateJunctionStyle, deleteComponentCascade, deleteJunctionCascade, deleteWireCascade, getCollinearRun } from "./junctions";
import { hitTestComponent, hitTestJunction, hitTestWire, hitTestPort, updateHoverCursor } from "./hitTest";
import { showParamOverlay, showWireOverlay, closeParamOverlay, isParamOverlayOpen, isParamOverlayContaining } from "./overlays";

// --- Toolbar button handlers ---

export function initToolbar(): void {
  btnRotate.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.rotation = (comp.rotation + 90) % 360;
      saveDocument();
    }
  });

  btnFlipH.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.flipH = !(comp.flipH ?? false);
      saveDocument();
    }
  });

  btnFlipV.addEventListener("click", () => {
    const comp = getSelectedComponent();
    if (comp) {
      comp.flipV = !(comp.flipV ?? false);
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
    btnWireMode.classList.toggle("active", S.wireMode);
    if (!S.wireMode) {
      S.wireDrawing = false;
      S.wireStartAnchor = null;
      S.wirePreviewEnd = null;
    }
    canvas.style.cursor = S.wireMode ? "crosshair" : "default";
  });
}

// --- Event listeners ---

export function initEventListeners(): void {
  // --- Right-click context menu ---
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    if (S.wireDrawing) {
      S.wireDrawing = false;
      S.wireStartAnchor = null;
      S.wirePreviewEnd = null;
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
        S.wireDrawing = false;
        S.wireStartAnchor = null;
        S.wirePreviewEnd = null;
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
    }

    if (e.key === "w" || e.key === "W") {
      btnWireMode.click();
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
          const portHit = hitTestPort(world.x, world.y);
          if (portHit) {
            S.wireStartAnchor = portHit;
            S.wireDrawing = true;
            return;
          }
          const jHit = hitTestJunction(world.x, world.y);
          if (jHit) {
            S.wireStartAnchor = { type: "junction", id: jHit.id, x: jHit.x, y: jHit.y };
            S.wireDrawing = true;
            return;
          }
          const wireHit = hitTestWire(world.x, world.y);
          if (wireHit) {
            const splitJ = splitWireAtPoint(wireHit, world.x, world.y);
            if (splitJ) {
              S.wireStartAnchor = { type: "junction", id: splitJ.id, x: splitJ.x, y: splitJ.y };
              S.wireDrawing = true;
              saveDocument();
              return;
            }
          }
          const snapped = { x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 };
          const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
          S.documentData.junctions.push(newJ);
          S.wireStartAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
          S.wireDrawing = true;
          saveDocument();
          return;
        } else {
          // Complete wire
          const rawEnd = { x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 };

          let endAnchor: WireAnchor | null = hitTestPort(rawEnd.x, rawEnd.y);
          if (!endAnchor) {
            const jHit = hitTestJunction(rawEnd.x, rawEnd.y);
            if (jHit) {
              endAnchor = { type: "junction", id: jHit.id, x: jHit.x, y: jHit.y };
            }
          }
          if (!endAnchor) {
            const wireHit = hitTestWire(rawEnd.x, rawEnd.y);
            if (wireHit) {
              const splitJ = splitWireAtPoint(wireHit, rawEnd.x, rawEnd.y);
              if (splitJ) {
                endAnchor = { type: "junction", id: splitJ.id, x: splitJ.x, y: splitJ.y };
              }
            }
          }

          const startX = S.wireStartAnchor!.x;
          const startY = S.wireStartAnchor!.y;
          const endPos = endAnchor ? { x: endAnchor.x, y: endAnchor.y } : rawEnd;
          const adx = Math.abs(endPos.x - startX);
          const ady = Math.abs(endPos.y - startY);
          const maxD = Math.max(adx, ady);
          const minD = Math.min(adx, ady);
          const isNearlyHV = minD < 0.05 || (maxD > 0 && minD / maxD < 0.33);

          if (isNearlyHV) {
            if (!endAnchor) {
              const snapped = snapWireEnd(startX, startY, rawEnd.x, rawEnd.y);
              const newJ: OfaJunction = { id: generateId(), x: snapped.x, y: snapped.y, style: "d2" };
              S.documentData.junctions.push(newJ);
              endAnchor = { type: "junction", id: newJ.id, x: snapped.x, y: snapped.y };
            }

            if (S.wireStartAnchor!.id === endAnchor.id && S.wireStartAnchor!.type === endAnchor.type) {
              return;
            }

            const newWire: OfaWire = {
              id: generateId(),
              layer: wireLayerSelect.value,
              width: 0.1,
              startId: S.wireStartAnchor!.id,
              startType: S.wireStartAnchor!.type,
              startComponentId: S.wireStartAnchor!.componentId,
              endId: endAnchor.id,
              endType: endAnchor.type,
              endComponentId: endAnchor.componentId,
            };
            S.documentData.wires.push(newWire);

            if (S.wireStartAnchor!.type === "junction") { autoUpdateJunctionStyle(S.wireStartAnchor!.id); }
            if (endAnchor.type === "junction") { autoUpdateJunctionStyle(endAnchor.id); }
          } else {
            // Manhattan Z-route
            if (!endAnchor) {
              const newJ: OfaJunction = { id: generateId(), x: rawEnd.x, y: rawEnd.y, style: "d2" };
              S.documentData.junctions.push(newJ);
              endAnchor = { type: "junction", id: newJ.id, x: rawEnd.x, y: rawEnd.y };
            }

            if (S.wireStartAnchor!.id === endAnchor.id && S.wireStartAnchor!.type === endAnchor.type) {
              return;
            }

            const midX = Math.round((startX + endAnchor.x) / 2 * 100) / 100;
            const j1: OfaJunction = { id: generateId(), x: midX, y: startY, style: "d2" };
            const j2: OfaJunction = { id: generateId(), x: midX, y: endAnchor.y, style: "d2" };
            S.documentData.junctions.push(j1, j2);

            const layer = wireLayerSelect.value;
            const w1: OfaWire = {
              id: generateId(), layer, width: 0.1,
              startId: S.wireStartAnchor!.id, startType: S.wireStartAnchor!.type, startComponentId: S.wireStartAnchor!.componentId,
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

            if (S.wireStartAnchor!.type === "junction") { autoUpdateJunctionStyle(S.wireStartAnchor!.id); }
            autoUpdateJunctionStyle(j1.id);
            autoUpdateJunctionStyle(j2.id);
            if (endAnchor.type === "junction") { autoUpdateJunctionStyle(endAnchor.id); }
          }

          saveDocument();
          S.wireStartAnchor = endAnchor;
          return;
        }
      }

      // --- NORMAL MODE ---

      const jHit = hitTestJunction(world.x, world.y);
      if (jHit) {
        S.selection = { type: "junction", id: jHit.id };
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
          _cache: info ? { xsize: info.xsize, ysize: info.ysize, ports: info.ports } : undefined,
        };
        if (newComp._cache) {
          componentSizeCache.set(newComp.id, newComp._cache);
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

            for (const j of run.junctions) {
              if (isH) {
                j.y = Math.round((j.y + dy) * 100) / 100;
              } else {
                j.x = Math.round((j.x + dx) * 100) / 100;
              }
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
