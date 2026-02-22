// Extension message handling (window "message" event listener)

import type { IncludeGeometry, PdkCellInfo } from "./types";
import { S, componentSizeCache, pendingQueries, vscode, componentSelect, includeSelect, includeGeometryCache, pendingIncludeQueries, btnExportGds, btnExportSpice, saveDocument, clearSelection } from "./state";
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
        if (S.documentData && !S.documentData.externalPorts) { S.documentData.externalPorts = []; }
        if (S.documentData && !S.documentData.includes) { S.documentData.includes = []; }
        if (S.documentData && !S.documentData.sources) { S.documentData.sources = []; }
        if (S.selection.type === "component" && S.selection.id) {
          const stillExists = S.documentData!.components.some((c) => c.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "junction" && S.selection.id) {
          const stillExists = S.documentData!.junctions.some((j) => j.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "wire" && S.selection.id) {
          const stillExists = S.documentData!.wires.some((w) => w.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "externalPort" && S.selection.id) {
          const stillExists = S.documentData!.externalPorts.some((ep) => ep.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "include" && S.selection.id) {
          const stillExists = (S.documentData!.includes ?? []).some((inc) => inc.id === S.selection.id);
          if (!stillExists) { clearSelection(); }
        } else if (S.selection.type === "source" && S.selection.id) {
          const stillExists = (S.documentData!.sources ?? []).some((s) => s.id === S.selection.id);
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
          // Request missing include geometry
          for (const inc of S.documentData.includes ?? []) {
            if (!includeGeometryCache.has(inc.id) && !pendingIncludeQueries.has(inc.id)) {
              pendingIncludeQueries.add(inc.id);
              vscode.postMessage({ type: "queryIncludeGeometry", includeId: inc.id, file: inc.file });
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
          componentSizeCache.set(msg.componentId, { xsize: msg.xsize, ysize: msg.ysize, ports: msg.ports });
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
      case "exportSpiceResult": {
        btnExportSpice.disabled = false;
        btnExportSpice.textContent = "Export SPICE";
        if (msg.error) {
          console.warn(`OFA: SPICE export failed: ${msg.error}`);
        }
        break;
      }
      case "includeGeometryResult": {
        pendingIncludeQueries.delete(msg.includeId);
        if (msg.geometry) {
          includeGeometryCache.set(msg.includeId, msg.geometry as IncludeGeometry);
        }
        break;
      }
      case "includeList": {
        const files: string[] = msg.files ?? [];
        includeSelect.innerHTML = "";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "-- Select .ofa --";
        includeSelect.appendChild(defaultOpt);
        for (const f of files) {
          const opt = document.createElement("option");
          opt.value = f;
          opt.textContent = f;
          includeSelect.appendChild(opt);
        }
        break;
      }
      case "includeFileChanged": {
        // Re-query geometry for any includes referencing the changed file
        if (!S.documentData) { break; }
        const changedFile = msg.file as string;
        for (const inc of S.documentData.includes ?? []) {
          if (inc.file === changedFile) {
            includeGeometryCache.delete(inc.id);
            pendingIncludeQueries.add(inc.id);
            vscode.postMessage({ type: "queryIncludeGeometry", includeId: inc.id, file: inc.file });
          }
        }
        break;
      }
    }
  });
}
