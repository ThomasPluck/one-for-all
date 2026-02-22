// Junction management: pinning, classification, collinear runs, auto-styling,
// wire splitting, cleanup, and cascade deletes

import type { CardinalDir, CollinearRun, OfaJunction, OfaWire } from "./types";
import { S, JUNCTION_RADIUS, generateId } from "./state";
import { LAYER_COLORS } from "./pdk";
import { resolveAnchorPosition } from "./geometry";

// --- Orphan cleanup ---

export function cleanupOrphanedJunctions(): void {
  if (!S.documentData) { return; }
  S.documentData.junctions = S.documentData.junctions.filter((j) => {
    return S.documentData!.wires.some((w) =>
      (w.startType === "junction" && w.startId === j.id) ||
      (w.endType === "junction" && w.endId === j.id)
    );
  });
}

// --- Junction pinning ---

export function isJunctionPinned(junctionId: string, dragAxis?: "H" | "V"): boolean {
  if (!S.documentData) { return true; }
  const j = S.documentData.junctions.find((jn) => jn.id === junctionId);
  if (!j) { return true; }
  if (j.style === "hp" || j.style === "vp") { return true; }
  const connected = S.documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );
  // Pinned if directly connected to a port or external port (immutable anchors)
  for (const w of connected) {
    const isStart = w.startType === "junction" && w.startId === junctionId;
    const otherType = isStart ? w.endType : w.startType;
    if (otherType === "port" || otherType === "externalPort" || otherType === "includePort") {
      if (!dragAxis) { return true; }
      // Axis-aware: pinned only if the port wire is perpendicular to the drag axis
      const otherPos = resolveAnchorPosition(
        isStart ? w.endId : w.startId,
        isStart ? w.endType : w.startType,
        isStart ? w.endComponentId : w.startComponentId,
      );
      if (!otherPos) { return true; }
      const isWireH = Math.abs(otherPos.y - j.y) < 0.001;
      // Wire horizontal + drag H → not pinned (just extends/shortens wire)
      // Wire horizontal + drag V → pinned (would break Manhattan)
      if (isWireH && dragAxis === "V") { return true; }
      if (!isWireH && dragAxis === "H") { return true; }
    }
  }
  return connected.length >= 5;
}

// --- Direction classification ---

export function classifyDirection(junction: OfaJunction, wire: OfaWire): CardinalDir | null {
  const isStart = wire.startType === "junction" && wire.startId === junction.id;
  const otherPos = resolveAnchorPosition(
    isStart ? wire.endId : wire.startId,
    isStart ? wire.endType : wire.startType,
    isStart ? wire.endComponentId : wire.startComponentId,
  );
  if (!otherPos) { return null; }
  const dx = otherPos.x - junction.x;
  const dy = otherPos.y - junction.y;
  if (Math.abs(dx) > Math.abs(dy)) { return dx > 0 ? "E" : "W"; }
  return dy > 0 ? "S" : "N";
}

function oppositeDir(dir: CardinalDir): CardinalDir {
  return dir === "N" ? "S" : dir === "S" ? "N" : dir === "E" ? "W" : "E";
}

// --- Direction from two points (no wire object needed) ---

export function classifyDirectionFromPoints(
  fromX: number, fromY: number, toX: number, toY: number,
): CardinalDir {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > Math.abs(dy)) { return dx > 0 ? "E" : "W"; }
  return dy > 0 ? "S" : "N";
}

// --- Occupied / reserved direction queries ---

export function getOccupiedDirections(junctionId: string): Set<CardinalDir> {
  const dirs = new Set<CardinalDir>();
  if (!S.documentData) { return dirs; }
  const junction = S.documentData.junctions.find((j) => j.id === junctionId);
  if (!junction) { return dirs; }
  const connected = S.documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );
  for (const wire of connected) {
    const dir = classifyDirection(junction, wire);
    if (dir) { dirs.add(dir); }
  }
  return dirs;
}

export function isDirectionAvailable(junctionId: string, dir: CardinalDir): boolean {
  if (!S.documentData) { return false; }
  const junction = S.documentData.junctions.find((j) => j.id === junctionId);
  if (!junction) { return false; }
  if (junction.reservedDirs && junction.reservedDirs.includes(dir)) { return false; }
  const occupied = getOccupiedDirections(junctionId);
  return !occupied.has(dir);
}

// --- Collinear run: unified primitive for wire drag propagation ---

function walkAxis(
  junctionId: string, fromWireId: string,
  movable: OfaJunction[], touched: Set<string>, visited: Set<string>,
  dragAxis?: "H" | "V",
): void {
  if (!S.documentData || visited.has(junctionId)) { return; }
  visited.add(junctionId);

  const junction = S.documentData.junctions.find((j) => j.id === junctionId);
  if (!junction) { return; }

  const connected = S.documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );

  const fromWire = connected.find((w) => w.id === fromWireId);
  if (!fromWire) { return; }
  const fromDir = classifyDirection(junction, fromWire);
  if (!fromDir) { return; }

  const target = oppositeDir(fromDir);
  const continuation = connected.find((w) => {
    if (w.id === fromWireId) { return false; }
    return classifyDirection(junction, w) === target;
  });
  if (!continuation) { return; }

  const isStart = continuation.startType === "junction" && continuation.startId === junctionId;
  const farType = isStart ? continuation.endType : continuation.startType;
  const farId = isStart ? continuation.endId : continuation.startId;

  if (farType !== "junction") { return; }
  touched.add(farId);
  if (isJunctionPinned(farId, dragAxis)) { return; }

  const farJ = S.documentData.junctions.find((j) => j.id === farId);
  if (!farJ || movable.includes(farJ)) { return; }

  movable.push(farJ);
  walkAxis(farId, continuation.id, movable, touched, visited, dragAxis);
}

export function getCollinearRun(wire: OfaWire, dragAxis?: "H" | "V"): CollinearRun {
  const movable: OfaJunction[] = [];
  const touched = new Set<string>();
  if (!S.documentData) { return { junctions: movable, allTouchedIds: touched }; }

  for (const ep of ["start", "end"] as const) {
    const epType = ep === "start" ? wire.startType : wire.endType;
    const epId = ep === "start" ? wire.startId : wire.endId;
    if (epType !== "junction") { continue; }
    touched.add(epId);

    const epJ = S.documentData.junctions.find((j) => j.id === epId);
    if (epJ && !isJunctionPinned(epId, dragAxis) && !movable.includes(epJ)) {
      movable.push(epJ);
    }

    walkAxis(epId, wire.id, movable, touched, new Set<string>(), dragAxis);
  }

  // If any junction in the chain is pinned for this drag axis, the entire chain is immovable
  for (const id of touched) {
    if (isJunctionPinned(id, dragAxis)) {
      return { junctions: [], allTouchedIds: touched };
    }
  }

  return { junctions: movable, allTouchedIds: touched };
}

// --- Connected-wire queries ---

export function entityHasWires(entityId: string, entityType: "port" | "externalPort" | "includePort" | "source"): boolean {
  if (!S.documentData) { return false; }
  if (entityType === "source") {
    return S.documentData.wires.some((w) =>
      (w.startType === "source" && w.startId === entityId) ||
      (w.endType === "source" && w.endId === entityId)
    );
  }
  return S.documentData.wires.some((w) =>
    (w.startType === entityType && (entityType === "externalPort" ? w.startId === entityId : w.startComponentId === entityId)) ||
    (w.endType === entityType && (entityType === "externalPort" ? w.endId === entityId : w.endComponentId === entityId))
  );
}

// --- Cascade deletes ---

export function deleteComponentCascade(compId: string): void {
  if (!S.documentData) { return; }
  S.documentData.components = S.documentData.components.filter((c) => c.id !== compId);
  S.documentData.wires = S.documentData.wires.filter((w) =>
    !(w.startType === "port" && w.startComponentId === compId) &&
    !(w.endType === "port" && w.endComponentId === compId)
  );
  cleanupOrphanedJunctions();
}

export function deleteJunctionCascade(jId: string): void {
  if (!S.documentData) { return; }
  S.documentData.junctions = S.documentData.junctions.filter((j) => j.id !== jId);
  S.documentData.wires = S.documentData.wires.filter((w) =>
    !(w.startType === "junction" && w.startId === jId) &&
    !(w.endType === "junction" && w.endId === jId)
  );
}

export function deleteWireCascade(wId: string): void {
  if (!S.documentData) { return; }
  S.documentData.wires = S.documentData.wires.filter((w) => w.id !== wId);
  cleanupOrphanedJunctions();
}

export function deleteIncludeCascade(incId: string): void {
  if (!S.documentData) { return; }
  S.documentData.includes = (S.documentData.includes ?? []).filter((inc) => inc.id !== incId);
  S.documentData.wires = S.documentData.wires.filter((w) =>
    !(w.startType === "includePort" && w.startComponentId === incId) &&
    !(w.endType === "includePort" && w.endComponentId === incId)
  );
  cleanupOrphanedJunctions();
}

export function deleteExternalPortCascade(epId: string): void {
  if (!S.documentData) { return; }
  S.documentData.externalPorts = S.documentData.externalPorts.filter((ep) => ep.id !== epId);
  S.documentData.wires = S.documentData.wires.filter((w) =>
    !(w.startType === "externalPort" && w.startId === epId) &&
    !(w.endType === "externalPort" && w.endId === epId)
  );
  cleanupOrphanedJunctions();
}

export function deleteSourceCascade(srcId: string): void {
  if (!S.documentData) { return; }
  S.documentData.sources = (S.documentData.sources ?? []).filter((s) => s.id !== srcId);
  S.documentData.wires = S.documentData.wires.filter((w) =>
    !(w.startType === "source" && w.startId === srcId) &&
    !(w.endType === "source" && w.endId === srcId)
  );
  cleanupOrphanedJunctions();
}

// --- Wire splitting ---

export function splitWireAtPoint(wire: OfaWire, worldX: number, worldY: number): OfaJunction | null {
  if (!S.documentData) { return null; }

  const start = resolveAnchorPosition(wire.startId, wire.startType, wire.startComponentId);
  const end = resolveAnchorPosition(wire.endId, wire.endType, wire.endComponentId);
  if (!start || !end) { return null; }

  const isHorizontal = Math.abs(end.y - start.y) < 0.001;
  let projX: number;
  let projY: number;

  if (isHorizontal) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    projX = Math.max(minX, Math.min(worldX, maxX));
    projY = start.y;
  } else {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    projX = start.x;
    projY = Math.max(minY, Math.min(worldY, maxY));
  }

  projX = Math.round(projX * 100) / 100;
  projY = Math.round(projY * 100) / 100;

  if (Math.hypot(projX - start.x, projY - start.y) < JUNCTION_RADIUS) { return null; }
  if (Math.hypot(projX - end.x, projY - end.y) < JUNCTION_RADIUS) { return null; }

  const newJunction: OfaJunction = { id: generateId(), x: projX, y: projY, style: "d2" };
  S.documentData.junctions.push(newJunction);

  const wire1: OfaWire = {
    id: generateId(),
    layer: wire.layer,
    width: wire.width,
    startId: wire.startId,
    startType: wire.startType,
    startComponentId: wire.startComponentId,
    endId: newJunction.id,
    endType: "junction",
  };
  const wire2: OfaWire = {
    id: generateId(),
    layer: wire.layer,
    width: wire.width,
    startId: newJunction.id,
    startType: "junction",
    endId: wire.endId,
    endType: wire.endType,
    endComponentId: wire.endComponentId,
  };

  S.documentData.wires = S.documentData.wires.filter((w) => w.id !== wire.id);
  S.documentData.wires.push(wire1, wire2);

  autoUpdateJunctionStyle(newJunction.id);
  if (wire.startType === "junction") { autoUpdateJunctionStyle(wire.startId); }
  if (wire.endType === "junction") { autoUpdateJunctionStyle(wire.endId); }

  return newJunction;
}

// --- Junction auto-coloring ---

export function computeJunctionColors(junction: OfaJunction): string[] {
  if (!S.documentData) { return ["#888", "#888", "#888", "#888"]; }

  const connected = S.documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junction.id) ||
    (w.endType === "junction" && w.endId === junction.id)
  );

  if (connected.length === 0) { return ["#888", "#888", "#888", "#888"]; }

  const dirs: { layer: string; dir: "N" | "E" | "S" | "W" }[] = [];
  for (const wire of connected) {
    const isStart = wire.startType === "junction" && wire.startId === junction.id;
    const otherPos = resolveAnchorPosition(
      isStart ? wire.endId : wire.startId,
      isStart ? wire.endType : wire.startType,
      isStart ? wire.endComponentId : wire.startComponentId,
    );
    if (!otherPos) { continue; }
    const ddx = otherPos.x - junction.x;
    const ddy = otherPos.y - junction.y;
    let dir: "N" | "E" | "S" | "W";
    if (Math.abs(ddx) > Math.abs(ddy)) {
      dir = ddx > 0 ? "E" : "W";
    } else {
      dir = ddy > 0 ? "S" : "N";
    }
    dirs.push({ layer: wire.layer, dir });
  }

  const colorOf = (layer: string) => LAYER_COLORS[layer] || "#888";
  const fallback = connected[0]?.layer || "";

  switch (junction.style) {
    case "h2": {
      const left = dirs.find((d) => d.dir === "W");
      const right = dirs.find((d) => d.dir === "E");
      return [colorOf(left?.layer || fallback), colorOf(right?.layer || fallback)];
    }
    case "v2": {
      const top = dirs.find((d) => d.dir === "N");
      const bottom = dirs.find((d) => d.dir === "S");
      return [colorOf(top?.layer || fallback), colorOf(bottom?.layer || fallback)];
    }
    case "d2": {
      return [colorOf(connected[0]?.layer || ""), colorOf(connected[1]?.layer || connected[0]?.layer || "")];
    }
    case "x4": {
      const n = dirs.find((d) => d.dir === "N");
      const e = dirs.find((d) => d.dir === "E");
      const s = dirs.find((d) => d.dir === "S");
      const w = dirs.find((d) => d.dir === "W");
      return [colorOf(n?.layer || fallback), colorOf(e?.layer || fallback),
              colorOf(s?.layer || fallback), colorOf(w?.layer || fallback)];
    }
    case "hp": {
      const left = dirs.find((d) => d.dir === "W");
      const right = dirs.find((d) => d.dir === "E");
      return [colorOf(left?.layer || fallback), colorOf(right?.layer || fallback)];
    }
    case "vp": {
      const top = dirs.find((d) => d.dir === "N");
      const bottom = dirs.find((d) => d.dir === "S");
      return [colorOf(top?.layer || fallback), colorOf(bottom?.layer || fallback)];
    }
  }
  return ["#888"];
}

export function autoUpdateJunctionStyle(junctionId: string): void {
  if (!S.documentData) { return; }
  const junction = S.documentData.junctions.find((j) => j.id === junctionId);
  if (!junction) { return; }

  if (junction.style === "hp" || junction.style === "vp") { return; }

  const connected = S.documentData.wires.filter((w) =>
    (w.startType === "junction" && w.startId === junctionId) ||
    (w.endType === "junction" && w.endId === junctionId)
  );

  const dirSet = new Set<string>();
  for (const wire of connected) {
    const dir = classifyDirection(junction, wire);
    if (dir) { dirSet.add(dir); }
  }

  if (connected.length >= 3 || dirSet.size >= 3) {
    junction.style = "x4";
  } else if (dirSet.has("N") && dirSet.has("S") && !dirSet.has("E") && !dirSet.has("W")) {
    junction.style = "v2";
  } else if (dirSet.has("E") && dirSet.has("W") && !dirSet.has("N") && !dirSet.has("S")) {
    junction.style = "h2";
  } else {
    junction.style = "d2";
  }

  // Auto-compute reservedDirs from connected wires
  const occupiedDirs: CardinalDir[] = [];
  for (const wire of connected) {
    const dir = classifyDirection(junction, wire);
    if (dir && !occupiedDirs.includes(dir)) { occupiedDirs.push(dir); }
  }
  junction.reservedDirs = occupiedDirs.length > 0 ? occupiedDirs : undefined;
}
