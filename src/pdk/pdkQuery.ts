import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { OfaConfig, SUPPORTED_PDKS } from "../types.js";

function getPythonPath(root: string): string {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

function execPython(py: string, script: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use execFile to bypass shell quoting issues on Windows
    cp.execFile(py, ["-c", script], { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        // Libraries may print warnings to stdout; extract only the last line (the JSON)
        const lines = stdout.trim().split("\n");
        resolve(lines[lines.length - 1].trim());
      }
    });
  });
}

export interface PdkCellInfo {
  name: string;
}

export interface PdkConnectivityInfo {
  name: string;
}

export function readConfig(root: string): OfaConfig | undefined {
  const configPath = path.join(root, "ofa-config.json");
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // Backfill pythonImport for configs written before this field existed
    if (!raw.pythonImport && raw.pdk) {
      const match = SUPPORTED_PDKS.find((p) => p.id === raw.pdk);
      if (match) {
        raw.pythonImport = match.pythonImport;
      }
    }
    return raw;
  } catch {
    return undefined;
  }
}

export async function getPdkCells(
  root: string,
  config: OfaConfig
): Promise<PdkCellInfo[]> {
  const py = getPythonPath(root);
  const script = [
    `from ${config.pythonImport} import cells`,
    `from gdsfactory.get_factories import get_cells`,
    `import json`,
    `result = get_cells(cells)`,
    `print(json.dumps(list(result.keys())))`,
  ].join("; ");

  const output = await execPython(py, script, root);
  const names: string[] = JSON.parse(output);
  return names.map((name) => ({ name }));
}

export async function getPdkConnectivity(
  root: string,
  config: OfaConfig
): Promise<PdkConnectivityInfo[]> {
  const py = getPythonPath(root);
  const script = [
    `from ${config.pythonImport} import connectivity`,
    `import json`,
    `print(json.dumps([str(c) for c in connectivity]))`,
  ].join("; ");

  const output = await execPython(py, script, root);
  const names: string[] = JSON.parse(output);
  return names.map((name) => ({ name }));
}
