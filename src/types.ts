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
  _cache?: {
    xsize: number;
    ysize: number;
    ports: PdkPortInfo[];
  };
}

export interface OfaDocument {
  version: number;
  components: OfaComponent[];
  junctions: unknown[];
  wires: unknown[];
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
