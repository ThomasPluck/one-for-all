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

export const SUPPORTED_PDKS: PdkOption[] = [
  {
    id: "ihp-sg13g2",
    label: "IHP SG13G2",
    description: "130nm BiCMOS SiGe:C process (IHP Microelectronics)",
    pipPackage: "ihp-gdsfactory",
    pythonImport: "ihp",
  },
];
