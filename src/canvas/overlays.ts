// Parameter editing overlay and wire editing overlay (DOM modals)

import type { OfaComponent, OfaExternalPort, OfaInclude, OfaSource, OfaWire } from "./types";
import { S, saveDocument, vscode, pendingQueries, componentSizeCache, clearSelection } from "./state";
import { LAYER_COLORS, getCellInfo } from "./pdk";
import { autoUpdateJunctionStyle, deleteComponentCascade, deleteExternalPortCascade, deleteIncludeCascade, deleteSourceCascade, deleteWireCascade } from "./junctions";

let paramOverlay: HTMLDivElement | null = null;

export function closeParamOverlay(): void {
  if (paramOverlay) {
    paramOverlay.remove();
    paramOverlay = null;
  }
}

export function isParamOverlayOpen(): boolean {
  return paramOverlay !== null;
}

export function isParamOverlayContaining(target: Node): boolean {
  return paramOverlay !== null && paramOverlay.contains(target);
}

export function showParamOverlay(comp: OfaComponent, screenX: number, screenY: number): void {
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
    const liveComp = S.documentData?.components.find((c) => c.id === comp.id);
    if (!liveComp || !S.documentData) { closeParamOverlay(); return; }

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
    saveDocument();
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
    if (S.documentData) {
      deleteComponentCascade(comp.id);
      saveDocument();
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

export function showExternalPortOverlay(ep: OfaExternalPort, screenX: number, screenY: number): void {
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
  header.textContent = `ExtPort [${ep.id.substring(0, 6)}]`;
  overlay.appendChild(header);

  // Name input
  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";
  const nameLabel = document.createElement("label");
  nameLabel.style.cssText = "flex: 0 0 50px; text-align: right; opacity: 0.7;";
  nameLabel.textContent = "Name";
  nameRow.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = ep.name;
  nameInput.style.cssText = `flex: 1; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); border-radius: 2px; padding: 2px 4px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);`;
  nameRow.appendChild(nameInput);
  overlay.appendChild(nameRow);

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
    if (name === ep.layer) { opt.selected = true; }
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
  widthInput.value = String(ep.width);
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
    const liveEp = S.documentData?.externalPorts.find((p) => p.id === ep.id);
    if (!liveEp || !S.documentData) { closeParamOverlay(); return; }
    liveEp.name = nameInput.value.trim() || liveEp.name;
    liveEp.layer = layerSel.value;
    liveEp.width = Math.max(0.01, Number(widthInput.value) || 0.1);
    saveDocument();
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
    if (S.documentData) {
      deleteExternalPortCascade(ep.id);
      clearSelection();
      saveDocument();
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

export function showIncludeOverlay(inc: OfaInclude, screenX: number, screenY: number): void {
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
  header.textContent = `Subcell: ${inc.file}`;
  overlay.appendChild(header);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.style.cssText = `background: #a02020; color: #fff; border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px; margin-right: auto;`;
  deleteBtn.addEventListener("click", () => {
    if (S.documentData) {
      deleteIncludeCascade(inc.id);
      clearSelection();
      saveDocument();
    }
    closeParamOverlay();
  });

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open .ofa";
  openBtn.style.cssText = `background: var(--vscode-button-background, #007fd4); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;`;
  openBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openIncludeFile", file: inc.file });
    closeParamOverlay();
  });

  btnRow.appendChild(deleteBtn);
  btnRow.appendChild(openBtn);
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

export function showSourceOverlay(src: OfaSource, screenX: number, screenY: number): void {
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
  header.textContent = `Source [${src.id.substring(0, 6)}]`;
  overlay.appendChild(header);

  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";
  const nameLabel = document.createElement("label");
  nameLabel.style.cssText = "flex: 0 0 60px; text-align: right; opacity: 0.7;";
  nameLabel.textContent = "Name";
  nameRow.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = src.name;
  nameInput.style.cssText = `flex: 1; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); border-radius: 2px; padding: 2px 4px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);`;
  nameRow.appendChild(nameInput);
  overlay.appendChild(nameRow);

  const voltRow = document.createElement("div");
  voltRow.style.cssText = "display: flex; align-items: center; margin: 3px 0; gap: 6px;";
  const voltLabel = document.createElement("label");
  voltLabel.style.cssText = "flex: 0 0 60px; text-align: right; opacity: 0.7;";
  voltLabel.textContent = "Voltage";
  voltRow.appendChild(voltLabel);
  const voltInput = document.createElement("input");
  voltInput.type = "number";
  voltInput.step = "0.1";
  voltInput.value = String(src.voltage);
  voltInput.style.cssText = `flex: 1; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #555); border-radius: 2px; padding: 2px 4px; font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);`;
  voltRow.appendChild(voltInput);
  overlay.appendChild(voltRow);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);";

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cssText = `background: var(--vscode-button-background, #007fd4); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 2px; padding: 3px 12px; cursor: pointer; font-size: 11px;`;
  applyBtn.addEventListener("click", () => {
    const liveSrc = (S.documentData?.sources ?? []).find((s) => s.id === src.id);
    if (!liveSrc || !S.documentData) { closeParamOverlay(); return; }
    liveSrc.name = nameInput.value.trim() || liveSrc.name;
    liveSrc.voltage = Number(voltInput.value) || 0;
    saveDocument();
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
    if (S.documentData) {
      deleteSourceCascade(src.id);
      clearSelection();
      saveDocument();
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

export function showWireOverlay(wire: OfaWire, screenX: number, screenY: number): void {
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
    const liveWire = S.documentData?.wires.find((w) => w.id === wire.id);
    if (!liveWire || !S.documentData) { closeParamOverlay(); return; }
    liveWire.layer = layerSel.value;
    liveWire.width = Math.max(0.01, Number(widthInput.value) || 0.1);
    if (liveWire.startType === "junction") { autoUpdateJunctionStyle(liveWire.startId); }
    if (liveWire.endType === "junction") { autoUpdateJunctionStyle(liveWire.endId); }
    saveDocument();
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
    if (S.documentData) {
      deleteWireCascade(wire.id);
      clearSelection();
      saveDocument();
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
