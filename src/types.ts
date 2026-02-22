export interface PdkOption {
  id: string;
  label: string;
  description: string;
  pipPackage: string;
  pythonImport: string;
}

export interface OfaConfig {
  pdk: string;
  pdkPackage: string;
  pythonImport: string;
}

export interface EnvironmentStatus {
  venvExists: boolean;
  gdsfactoryInstalled: boolean;
  configExists: boolean;
  configValid: boolean;
  pdk?: string;
}

// --- OFA Document types ---

export interface OfaComponent {
  id: string;
  cell: string;
  x: number;
  y: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  params: Record<string, number | string | boolean>;
}

export type JunctionStyle = "h2" | "v2" | "d2" | "x4" | "hp" | "vp";

export interface OfaJunction {
  id: string;
  x: number;
  y: number;
  style: JunctionStyle;
}

export interface OfaWire {
  id: string;
  layer: string;
  width: number;
  startId: string;
  startType: "port" | "junction" | "externalPort" | "includePort" | "source";
  startComponentId?: string;
  endId: string;
  endType: "port" | "junction" | "externalPort" | "includePort" | "source";
  endComponentId?: string;
}

export interface OfaExternalPort {
  id: string;
  name: string;
  x: number;
  y: number;
  layer: string;
  width: number;
}

export interface OfaInclude {
  id: string;
  file: string;
  x: number;
  y: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface OfaSource {
  id: string;
  name: string;
  voltage: number;
  x: number;
  y: number;
}

export interface OfaDocument {
  version: number;
  components: OfaComponent[];
  junctions: OfaJunction[];
  wires: OfaWire[];
  externalPorts: OfaExternalPort[];
  includes?: OfaInclude[];
  sources?: OfaSource[];
}

// --- Enriched PDK types ---

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

export interface PdkConnectivityInfo {
  name: string;
}

export interface PdkLayerInfo {
  name: string;
  gds_layer: [number, number];
  color: string;
}

// --- Supported PDKs ---

export const SUPPORTED_PDKS: PdkOption[] = [
  {
    id: "ihp-sg13g2",
    label: "IHP SG13G2",
    description: "130nm BiCMOS SiGe:C process (IHP Microelectronics)",
    pipPackage: "ihp-gdsfactory",
    pythonImport: "ihp",
  },
];
