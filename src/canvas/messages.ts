// Extension message handling (window "message" event listener)

import type { PdkCellInfo } from "./types";
import { S, componentSizeCache, pendingQueries, vscode, componentSelect, btnExportGds, saveDocument, clearSelection } from "./state";
import { applyPdkLayers, getCellInfo } from "./pdk";

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

export function initMessageHandler(): void {
  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "update":
        S.documentData = msg.data;
        if (S.documentData && !S.documentData.junctions) { S.documentData.junctions = []; }
        if (S.documentData && !S.documentData.wires) { S.documentData.wires = []; }
        if (S.documentData) {
          for (const comp of S.documentData.components) {
            if (comp._cache && !componentSizeCache.has(comp.id)) {
              componentSizeCache.set(comp.id, comp._cache);
            }
          }
        }
        if (S.selection.type === "component" && S.selection.id) {
          const stillExists = S.documentData!.components.some((c) => c.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "junction" && S.selection.id) {
          const stillExists = S.documentData!.junctions.some((j) => j.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "wire" && S.selection.id) {
          const stillExists = S.documentData!.wires.some((w) => w.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        }
        if (S.documentData) {
          const currentIds = new Set(S.documentData.components.map((c) => c.id));
          for (const cachedId of componentSizeCache.keys()) {
            if (!currentIds.has(cachedId)) { componentSizeCache.delete(cachedId); }
          }
          for (const comp of S.documentData.components) {
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
        // Full data (from cache hit — all at once)
        S.pdkCells = (msg.cells || []) as PdkCellInfo[];
        populateSelect(componentSelect, S.pdkCells, "-- Select Device --");
        if (msg.layers && Array.isArray(msg.layers)) {
          applyPdkLayers(msg.layers);
        }
        break;
      }
      case "pdkFastData": {
        // Progressive: layers + connectivity arrive first (~2s)
        if (msg.layers && Array.isArray(msg.layers)) {
          applyPdkLayers(msg.layers);
        }
        break;
      }
      case "pdkCellData": {
        // Progressive: cells arrive later (4-15s)
        S.pdkCells = (msg.cells || []) as PdkCellInfo[];
        populateSelect(componentSelect, S.pdkCells, "-- Select Device --");
        break;
      }
      case "componentInfoResult": {
        pendingQueries.delete(msg.componentId);
        if (msg.error) {
          console.warn(`OFA: Component query failed for ${msg.componentId}: ${msg.error}`);
        } else {
          const cached = { xsize: msg.xsize, ysize: msg.ysize, ports: msg.ports };
          componentSizeCache.set(msg.componentId, cached);
          if (S.documentData) {
            const comp = S.documentData.components.find((c) => c.id === msg.componentId);
            if (comp) {
              comp._cache = cached;
              saveDocument();
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
}
