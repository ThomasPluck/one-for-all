import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { OfaConfig, PdkCellInfo, PdkConnectivityInfo, PdkLayerInfo, PdkPortInfo, SUPPORTED_PDKS } from "../types.js";

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
  // port.layer is a kfactory integer index — convert to GDS (layer, datatype) via get_info()
  const script = `
import json, inspect, warnings
warnings.filterwarnings("ignore")
from ${pdk} import cells, PDK
from gdsfactory.get_factories import get_cells
import gdsfactory as gf
import kfactory as kf

PDK.activate()
factories = get_cells(cells)

def port_gds_layer(port):
    """Convert port.layer (kfactory int index) to [gds_layer, gds_datatype]."""
    if not hasattr(port, "layer") or port.layer is None:
        return None
    raw = port.layer
    if isinstance(raw, int):
        try:
            li = kf.kcl.layout.get_info(raw)
            return [li.layer, li.datatype]
        except Exception:
            return [raw, 0]
    if hasattr(raw, "__iter__"):
        return list(raw)
    return [raw, 0]

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
        c.locked = False
        c.dmove((-c.xmin, -c.ymin))
        c.locked = True
        xsize = float(c.xsize)
        ysize = float(c.ysize)
        xmin = float(c.xmin)
        ymin = float(c.ymin)
        for port in c.ports:
            ports.append({
                "name": port.name,
                "x": float(port.center[0]) - xmin,
                "y": float(port.center[1]) - ymin,
                "layer": port_gds_layer(port),
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

// Distinct, high-contrast palette for layer coloring
const LAYER_PALETTE = [
  "#4caf50", "#2196f3", "#ff9800", "#9c27b0", "#f44336",
  "#00bcd4", "#ffeb3b", "#e91e63", "#8bc34a", "#ff5722",
  "#3f51b5", "#009688", "#cddc39", "#795548", "#607d8b",
];

export async function getPdkLayers(
  root: string,
  config: OfaConfig
): Promise<PdkLayerInfo[]> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;

  // Query LAYER_STACK — kfactory stores layers as integer indices, not GDS tuples.
  // Use kf.kcl.layout.get_info() to convert kfactory index -> GDS (layer, datatype).
  // Display names come from the LAYER enum "drawing" members (e.g. "Metal1drawing" -> "Metal1").
  const script = `
import json, warnings
warnings.filterwarnings("ignore")
from ${pdk} import PDK
PDK.activate()
import kfactory as kf

# Build display-name lookup from LAYER enum: (8,0) -> "Metal1"
display_map = {}
try:
    layer_enum = PDK.layers
    if layer_enum:
        for m in layer_enum:
            if not m.name.endswith('drawing'):
                continue
            try:
                li = kf.kcl.layout.get_info(m.value)
                display_map[(li.layer, li.datatype)] = m.name[:-7]
            except Exception:
                pass
except Exception:
    pass

result = []
ls = PDK.layer_stack
if ls and hasattr(ls, 'layers'):
    for name, info in ls.layers.items():
        if name == 'substrate':
            continue
        layer_obj = getattr(info, 'layer', None)
        if layer_obj is None:
            continue
        raw = getattr(layer_obj, 'layer', layer_obj)
        idx = raw.value if hasattr(raw, 'value') else raw
        if not isinstance(idx, int):
            continue
        try:
            li = kf.kcl.layout.get_info(idx)
            gds = [li.layer, li.datatype]
        except Exception:
            continue
        display = display_map.get(tuple(gds), name.capitalize())
        result.append({"name": display, "gds_layer": gds})
print(json.dumps(result))
`.trim();

  const output = await execPython(py, script, root);
  const raw: { name: string; gds_layer: [number, number] }[] = JSON.parse(output);

  return raw.map((layer, i) => ({
    ...layer,
    color: LAYER_PALETTE[i % LAYER_PALETTE.length],
  }));
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
from ${pdk} import cells, PDK
from gdsfactory.get_factories import get_cells
import gdsfactory as gf
import kfactory as kf

PDK.activate()
factories = get_cells(cells)

def port_gds_layer(port):
    if not hasattr(port, "layer") or port.layer is None:
        return None
    raw = port.layer
    if isinstance(raw, int):
        try:
            li = kf.kcl.layout.get_info(raw)
            return [li.layer, li.datatype]
        except Exception:
            return [raw, 0]
    if hasattr(raw, "__iter__"):
        return list(raw)
    return [raw, 0]

func = factories[${JSON.stringify(cellName)}]
params = json.loads(sys.argv[1] if len(sys.argv) > 1 else '{}')
sig = inspect.signature(func)
valid = {k: v for k, v in params.items() if k in sig.parameters}
c = func(**valid)
c.locked = False
c.dmove((-c.xmin, -c.ymin))
c.locked = True
xmin = float(c.xmin)
ymin = float(c.ymin)
ports = []
for port in c.ports:
    ports.append({
        "name": port.name,
        "x": float(port.center[0]) - xmin,
        "y": float(port.center[1]) - ymin,
        "layer": port_gds_layer(port),
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
        cell.locked = False
        cell.dmove((-cell.xmin, -cell.ymin))
        cell.locked = True
        ref = top.add_ref(cell)
        if comp.get("flipH"):
            ref.mirror_x()
        if comp.get("flipV"):
            ref.mirror_y()
        if comp.get("rotation"):
            ref.rotate(comp["rotation"])
        ref.move((comp["x"], -comp["y"] - float(cell.ysize)))
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
