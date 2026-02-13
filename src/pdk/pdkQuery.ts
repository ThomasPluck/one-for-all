import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { OfaConfig, PdkCellInfo, PdkConnectivityInfo, PdkPortInfo, SUPPORTED_PDKS } from "../types.js";

export interface ComponentQueryResult {
  xsize: number;
  ysize: number;
  ports: PdkPortInfo[];
}

function getPythonPath(root: string): string {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

function execPython(py: string, script: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use execFile to bypass shell quoting issues on Windows
    cp.execFile(py, ["-c", script], { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
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
  const pdk = config.pythonImport;

  // Bulk query: for each pcell, get function params (defaults) and ports from default instantiation
  const script = `
import json, inspect, warnings
warnings.filterwarnings("ignore")
from ${pdk} import cells
from gdsfactory.get_factories import get_cells
import gdsfactory as gf

factories = get_cells(cells)
result = []
for name, func in factories.items():
    sig = inspect.signature(func)
    params = {}
    for pname, p in sig.parameters.items():
        if p.default is not inspect.Parameter.empty:
            try:
                json.dumps(p.default)
                params[pname] = p.default
            except (TypeError, ValueError):
                pass
    ports = []
    xsize = 1.0
    ysize = 1.0
    try:
        c = gf.get_component(func)
        xsize = float(c.xsize)
        ysize = float(c.ysize)
        xmin = float(c.xmin)
        ymin = float(c.ymin)
        for port in c.ports:
            ports.append({
                "name": port.name,
                "x": float(port.center[0]) - xmin,
                "y": float(port.center[1]) - ymin,
                "layer": (list(port.layer) if hasattr(port.layer, "__iter__") else [port.layer, 0]) if hasattr(port, "layer") else None,
                "width": float(port.width)
            })
    except Exception:
        pass
    result.append({"name": name, "params": params, "ports": ports, "xsize": xsize, "ysize": ysize})
print(json.dumps(result))
`.trim();

  const output = await execPython(py, script, root);
  return JSON.parse(output) as PdkCellInfo[];
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

export async function getComponentInfo(
  root: string,
  config: OfaConfig,
  cellName: string,
  params: Record<string, unknown>
): Promise<ComponentQueryResult> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;
  const paramsJson = JSON.stringify(params);

  const script = `
import json, inspect, warnings, sys
warnings.filterwarnings("ignore")
from ${pdk} import cells
from gdsfactory.get_factories import get_cells
import gdsfactory as gf

from ${pdk} import PDK
PDK.activate()
factories = get_cells(cells)
func = factories[${JSON.stringify(cellName)}]
params = json.loads(sys.argv[1] if len(sys.argv) > 1 else '{}')
sig = inspect.signature(func)
valid = {k: v for k, v in params.items() if k in sig.parameters}
c = func(**valid)
xmin = float(c.xmin)
ymin = float(c.ymin)
ports = []
for port in c.ports:
    ports.append({
        "name": port.name,
        "x": float(port.center[0]) - xmin,
        "y": float(port.center[1]) - ymin,
        "layer": (list(port.layer) if hasattr(port.layer, "__iter__") else [port.layer, 0]) if hasattr(port, "layer") else None,
        "width": float(port.width)
    })
print(json.dumps({"xsize": float(c.xsize), "ysize": float(c.ysize), "ports": ports}))
`.trim();

  // Pass params as a CLI argument so we don't need string interpolation
  const output = await new Promise<string>((resolve, reject) => {
    cp.execFile(py, ["-c", script, paramsJson], { cwd: root, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        const lines = stdout.trim().split("\n");
        resolve(lines[lines.length - 1].trim());
      }
    });
  });
  return JSON.parse(output) as ComponentQueryResult;
}

export async function exportGds(
  root: string,
  config: OfaConfig,
  ofaPath: string
): Promise<string> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;

  const script = `
import json, inspect, sys, warnings, traceback
warnings.filterwarnings("ignore")
from ${pdk} import cells, PDK
from gdsfactory.get_factories import get_cells
import gdsfactory as gf

PDK.activate()
factories = get_cells(cells)

ofa_path = sys.argv[1]
with open(ofa_path) as f:
    ofa = json.load(f)

top = gf.Component("top")
errors = []
for i, comp in enumerate(ofa["components"]):
    try:
        func = factories[comp["cell"]]
        sig = inspect.signature(func)
        params = comp.get("params", {})
        valid = {k: v for k, v in params.items() if k in sig.parameters}
        cell = gf.get_component(func, **valid)
        ref = top.add_ref(cell)
        if comp.get("flipH"):
            ref.mirror_x()
        if comp.get("flipV"):
            ref.mirror_y()
        if comp.get("rotation"):
            ref.rotate(comp["rotation"])
        ref.move((comp["x"], comp["y"]))
    except Exception as e:
        errors.append(f"{comp.get('cell','?')}[{i}]: {e}")

gds_path = ofa_path.rsplit(".", 1)[0] + ".gds"
top.write_gds(gds_path)
print(json.dumps({"path": gds_path, "errors": errors}))
`.trim();

  const output = await new Promise<string>((resolve, reject) => {
    cp.execFile(py, ["-c", script, ofaPath], { cwd: root, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        const lines = stdout.trim().split("\n");
        resolve(lines[lines.length - 1].trim());
      }
    });
  });
  const result = JSON.parse(output);
  if (result.errors && result.errors.length > 0) {
    console.warn("OFA: GDS export warnings:", result.errors);
  }
  return result.path as string;
}
