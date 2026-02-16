// Canvas-local type definitions

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface PdkPortInfo {
  name: string;
  x: number;
  y: number;
  layer: [number, number] | null;
  width: number;
}

export interface PdkCellInfo {
  name: string;
  params: Record<string, unknown>;
  ports: PdkPortInfo[];
  xsize: number;
  ysize: number;
}

export interface OfaComponent {
  id: string;
  cell: string;
  x: number;
  y: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  params: Record<string, number | string | boolean>;
  _cache?: { xsize: number; ysize: number; ports: PdkPortInfo[] };
}

export type JunctionStyle = "h2" | "v2" | "d2" | "x4" | "hp" | "vp";

export interface OfaJunction {
  id: string;
  x: number;
  y: number;
  style: JunctionStyle;
  reservedDirs?: CardinalDir[];
}

export interface OfaWire {
  id: string;
  layer: string;
  width: number;
  startId: string;
  startType: "port" | "junction";
  startComponentId?: string;
  endId: string;
  endType: "port" | "junction";
  endComponentId?: string;
}

export interface DocumentData {
  version: number;
  components: OfaComponent[];
  junctions: OfaJunction[];
  wires: OfaWire[];
}

export interface WireAnchor {
  type: "port" | "junction";
  id: string;
  componentId?: string;
  x: number;
  y: number;
}

export interface SelectionState {
  type: "none" | "component" | "junction" | "wire";
  id: string | null;
}

export type CardinalDir = "N" | "E" | "S" | "W";

export interface CollinearRun {
  junctions: OfaJunction[];
  allTouchedIds: Set<string>;
}

declare global {
  function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}
