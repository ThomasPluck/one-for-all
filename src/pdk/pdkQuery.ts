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

  // Query ROUTING_STACK — only routable metal layers (poly + metals).
  // Uses get_routing_stack() from the PDK's tech module.
  const script = `
import json, warnings
warnings.filterwarnings("ignore")
from ${pdk}.tech import get_routing_stack
from ${pdk} import PDK
PDK.activate()
import kfactory as kf

rs = get_routing_stack()
result = []
for name, info in rs.layers.items():
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
    result.append({"name": name, "gds_layer": gds})
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

/**
 * Streaming merged query: runs cells + connectivity + layers in a single Python process.
 * Emits fast data (connectivity + layers) first via onFastData callback,
 * then resolves with cell data when complete.
 */
export function getPdkAllDataStreaming(
  root: string,
  config: OfaConfig,
  onFastData: (connectivity: PdkConnectivityInfo[], layers: PdkLayerInfo[]) => void,
): Promise<PdkCellInfo[]> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;

  const script = `
import json, inspect, warnings, sys
warnings.filterwarnings("ignore")
from ${pdk} import cells, PDK, connectivity
from gdsfactory.get_factories import get_cells
import gdsfactory as gf
import kfactory as kf

PDK.activate()

# --- Connectivity (fast) ---
conn_result = [str(c) for c in connectivity]

# --- Layers (fast) via routing stack ---
from ${pdk}.tech import get_routing_stack
rs = get_routing_stack()
layers_result = []
for name, info in rs.layers.items():
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
    layers_result.append({"name": name, "gds_layer": gds})

# Emit fast data first
print("FAST:" + json.dumps({"connectivity": conn_result, "layers": layers_result}))
sys.stdout.flush()

# --- Cells (slow) ---
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

cells_result = []
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
    cells_result.append({"name": name, "params": params, "ports": ports, "xsize": xsize, "ysize": ysize})

print("CELLS:" + json.dumps(cells_result))
`.trim();

  return new Promise((resolve, reject) => {
    const proc = cp.execFile(py, ["-c", script], { cwd: root, timeout: 120_000 });
    let buffer = "";
    let fastSent = false;

    proc.stdout!.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete last line in buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { continue; }
        if (trimmed.startsWith("FAST:") && !fastSent) {
          fastSent = true;
          try {
            const fast = JSON.parse(trimmed.slice(5));
            const layers: PdkLayerInfo[] = (fast.layers || []).map(
              (l: { name: string; gds_layer: [number, number] }, i: number) => ({
                ...l,
                color: LAYER_PALETTE[i % LAYER_PALETTE.length],
              })
            );
            const connectivity: PdkConnectivityInfo[] = (fast.connectivity || []).map(
              (n: string) => ({ name: n })
            );
            onFastData(connectivity, layers);
          } catch {
            // skip malformed fast data
          }
        } else if (trimmed.startsWith("CELLS:")) {
          try {
            resolve(JSON.parse(trimmed.slice(6)) as PdkCellInfo[]);
          } catch {
            // skip malformed cell data
          }
        }
        // skip other lines (library warnings)
      }
    });

    let stderrBuf = "";
    proc.stderr!.on("data", (chunk: Buffer | string) => {
      stderrBuf += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      // Process remaining buffer
      const trimmed = buffer.trim();
      if (trimmed.startsWith("CELLS:")) {
        try {
          resolve(JSON.parse(trimmed.slice(6)) as PdkCellInfo[]);
          return;
        } catch { /* fall through */ }
      }
      if (code !== 0) {
        reject(new Error(stderrBuf || `Python exited with code ${code}`));
      }
    });
  });
}

export async function exportSpice(
  root: string,
  config: OfaConfig,
  ofaPath: string
): Promise<string> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;

  const script = `
import json, inspect, sys, warnings, os
warnings.filterwarnings("ignore")
from ${pdk} import cells, PDK
from ${pdk}.config import PATH
from ${pdk}.tech import get_sheet_resistance
from gdsfactory.get_factories import get_cells
import gdsfactory as gf

PDK.activate()
factories = get_cells(cells)
RSH = get_sheet_resistance()

# --- Load OFA document ---
ofa_path = sys.argv[1]
with open(ofa_path) as f:
    ofa = json.load(f)

components = {c["id"]: c for c in ofa.get("components", [])}
junctions = {j["id"]: j for j in ofa.get("junctions", [])}
ext_ports = {ep["id"]: ep for ep in ofa.get("externalPorts", [])}
sources = {s["id"]: s for s in ofa.get("sources", [])}
wires = ofa.get("wires", [])
errors = []

# --- Union-Find for net extraction ---
parent = {}
def find(x):
    while parent.get(x, x) != x:
        parent[x] = parent.get(parent[x], parent[x])
        x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb

def anchor_key(ep, wire):
    t = wire[f"{ep}Type"]
    i = wire[f"{ep}Id"]
    c = wire.get(f"{ep}ComponentId")
    if t == "port" and c:
        return f"port:{c}:{i}"
    if t == "source":
        return f"source:{i}"
    if t == "externalPort":
        return f"extport:{i}"
    if t == "junction":
        return f"junction:{i}"
    if t == "includePort" and c:
        return f"incport:{c}:{i}"
    return f"{t}:{i}"

# Build connectivity
for wire in wires:
    a = anchor_key("start", wire)
    b = anchor_key("end", wire)
    parent.setdefault(a, a)
    parent.setdefault(b, b)
    union(a, b)

# Assign net names
net_names = {}
auto_idx = [1]
def get_net(key):
    root = find(key)
    if root in net_names:
        return net_names[root]
    return None

# First pass: name nets from sources and external ports
for sid, src in sources.items():
    key = find(f"source:{sid}")
    if src["voltage"] == 0 or src["name"].upper() == "GND":
        net_names[key] = "0"
    else:
        net_names[key] = src["name"]

for epid, ep in ext_ports.items():
    key = find(f"extport:{epid}")
    if key not in net_names:
        net_names[key] = ep["name"]

# Second pass: auto-name remaining
for key in parent:
    root = find(key)
    if root not in net_names:
        net_names[root] = f"n{auto_idx[0]}"
        auto_idx[0] += 1

def net_for(ep, wire):
    key = anchor_key(ep, wire)
    root = find(key)
    return net_names.get(root, "?")

# --- Instantiate components using VLSIR ---
spice_lines = []
spice_libs = set()
osdi_deps = set()

for comp_id, comp in components.items():
    cell_name = comp["cell"]
    if cell_name not in factories:
        errors.append(f"Unknown cell: {cell_name}")
        continue
    func = factories[cell_name]
    sig = inspect.signature(func)
    params = comp.get("params", {})
    valid = {k: v for k, v in params.items() if k in sig.parameters}
    try:
        cell = gf.get_component(func, **valid)
    except Exception as e:
        errors.append(f"{cell_name}: {e}")
        continue
    vlsir = cell.info.get("vlsir")
    if not vlsir:
        errors.append(f"{cell_name}: no VLSIR metadata")
        continue

    model = vlsir.get("model", cell_name)
    port_order = vlsir.get("port_order", [])
    port_map = vlsir.get("port_map", {})
    spice_params = vlsir.get("params", {})
    spice_lib = vlsir.get("spice_lib")
    cell_osdi = vlsir.get("osdi_deps", [])

    if spice_lib:
        spice_libs.add(spice_lib)
    for od in cell_osdi:
        osdi_deps.add(od)

    # Map SPICE ports to nets
    # port_map: {component_port_name: spice_port_name}
    # port_order: ordered list of spice port names
    inv_map = {v: k for k, v in port_map.items()}  # spice_name -> comp_port_name
    port_nets = []
    for sp in port_order:
        comp_port = inv_map.get(sp)
        if comp_port:
            # Find the net for this port
            key = f"port:{comp_id}:{comp_port}"
            if key in parent:
                root = find(key)
                port_nets.append(net_names.get(root, "0"))
            else:
                port_nets.append("0")
        else:
            port_nets.append("0")  # unconnected (e.g. bulk)

    # Build param string from component params merged with VLSIR defaults
    param_strs = []
    for pk, pv in spice_params.items():
        # Use component param value if available, else VLSIR default
        actual = valid.get(pk, pv)
        if isinstance(actual, (int, float)):
            param_strs.append(f"{pk}={actual}")

    inst_name = f"X_{comp_id.replace('-', '_')[:16]}"
    nets_str = " ".join(port_nets)
    params_str = " ".join(param_strs)
    spice_lines.append(f"{inst_name} {nets_str} {model} {params_str}")

# --- Wire parasitic resistors (all layers with known Rsh) ---
resistor_lines = []
r_idx = 1

def resolve_pos(ep_type, ep_id):
    if ep_type == "junction" and ep_id in junctions:
        return (junctions[ep_id]["x"], junctions[ep_id]["y"])
    if ep_type == "source" and ep_id in sources:
        return (sources[ep_id]["x"], sources[ep_id]["y"])
    if ep_type == "externalPort" and ep_id in ext_ports:
        return (ext_ports[ep_id]["x"], ext_ports[ep_id]["y"])
    return None

for wire in wires:
    layer = wire.get("layer", "Metal1")
    rsh = RSH.get(layer)
    if not rsh:
        continue
    sn = net_for("start", wire)
    en = net_for("end", wire)
    if sn == en:
        continue
    s_pos = resolve_pos(wire["startType"], wire["startId"])
    e_pos = resolve_pos(wire["endType"], wire["endId"])
    if not s_pos or not e_pos:
        continue
    length = abs(e_pos[0] - s_pos[0]) + abs(e_pos[1] - s_pos[1])
    width = wire.get("width", 0.1)
    if length < 0.001 or width < 0.001:
        continue
    R = rsh * length / width
    if R < 1e-6:
        continue  # skip negligibly small resistors
    resistor_lines.append(f"R_{layer}_{r_idx} {sn} {en} {R:.6g}")
    r_idx += 1

# --- Voltage sources ---
vsource_lines = []
for sid, src in sources.items():
    if src["voltage"] == 0 or src["name"].upper() == "GND":
        continue
    key = find(f"source:{sid}")
    net = net_names.get(key, src["name"])
    vsource_lines.append(f"V_{src['name']} {net} 0 DC {src['voltage']}")

# --- Model library paths ---
model_dir = str(PATH.module / "models" / "ngspice" / "models")
osdi_dir = str(PATH.module / "models" / "ngspice" / "osdi")

# --- Assemble netlist ---
out = []
out.append(f"* OFA SPICE Netlist - DC Operating Point")
out.append(f"* Generated from: {os.path.basename(ofa_path)}")
out.append("")

# OSDI compact models
if osdi_deps:
    out.append("** OSDI Compact Models")
    out.append(".control")
    for od in sorted(osdi_deps):
        osdi_path = os.path.join(osdi_dir, od)
        if os.path.exists(osdi_path):
            out.append(f"pre_osdi {osdi_path}")
        else:
            out.append(f"* WARNING: OSDI model '{od}' not found at {osdi_path}")
    out.append(".endc")
    out.append("")

# Model libraries
if spice_libs:
    out.append("** Model Libraries")
    for lib in sorted(spice_libs):
        lib_path = os.path.join(model_dir, lib)
        out.append(f'.include "{lib_path}"')
    out.append("")

# Subcircuit instances
if spice_lines:
    out.append("** Subcircuit Instances")
    for line in spice_lines:
        out.append(line)
    out.append("")

# Parasitic resistors
if resistor_lines:
    out.append("** Wire Parasitic Resistors (Rsh from PDK get_sheet_resistance())")
    for line in resistor_lines:
        out.append(line)
    out.append("")

# Voltage sources
if vsource_lines:
    out.append("** Voltage Sources")
    for line in vsource_lines:
        out.append(line)
    out.append("")

# Analysis
out.append("** Analysis")
out.append(".op")
out.append(".end")
out.append("")

# --- Write .cir file ---
cir_path = ofa_path.rsplit(".", 1)[0] + ".cir"
with open(cir_path, "w") as f:
    f.write("\\n".join(out))

print(json.dumps({"path": cir_path, "errors": errors}))
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
    console.warn("OFA: SPICE export warnings:", result.errors);
  }
  return result.path as string;
}

export async function exportGds(
  root: string,
  config: OfaConfig,
  ofaPath: string
): Promise<string> {
  const py = getPythonPath(root);
  const pdk = config.pythonImport;

  const script = `
import json, inspect, sys, warnings
warnings.filterwarnings("ignore")
from ${pdk} import cells, PDK
from ${pdk}.tech import get_routing_stack
from gdsfactory.get_factories import get_cells
import gdsfactory as gf
import kfactory as kf

PDK.activate()
factories = get_cells(cells)

# --- Layer GDS lookup from routing stack ---
rs = get_routing_stack()
layer_gds = {}
for name, info in rs.layers.items():
    layer_obj = getattr(info, 'layer', None)
    if layer_obj is None:
        continue
    raw = getattr(layer_obj, 'layer', layer_obj)
    idx = raw.value if hasattr(raw, 'value') else raw
    if not isinstance(idx, int):
        continue
    try:
        li = kf.kcl.layout.get_info(idx)
        layer_gds[name] = (li.layer, li.datatype)
    except Exception:
        continue

LAYER_ORDER = list(rs.layers.keys())

# --- Load OFA document ---
ofa_path = sys.argv[1]
with open(ofa_path) as f:
    ofa = json.load(f)

top = gf.Component("top")
errors = []

# --- Lookup tables ---
junctions_by_id = {j["id"]: j for j in ofa.get("junctions", [])}
ext_ports_by_id = {ep["id"]: ep for ep in ofa.get("externalPorts", [])}

# --- Phase 1: Components + port position capture ---
comp_port_positions = {}

for i, comp in enumerate(ofa.get("components", [])):
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
        port_map = {}
        for port in ref.ports:
            port_map[port.name] = (float(port.center[0]), float(port.center[1]))
        comp_port_positions[comp["id"]] = port_map
    except Exception as e:
        errors.append(f"{comp.get('cell','?')}[{i}]: {e}")

# --- Wire endpoint resolver ---
def resolve_ep(wire, ep):
    ep_type = wire[f"{ep}Type"]
    ep_id = wire[f"{ep}Id"]
    ep_comp = wire.get(f"{ep}ComponentId")
    if ep_type == "junction":
        j = junctions_by_id.get(ep_id)
        return (j["x"], -j["y"]) if j else None
    if ep_type == "externalPort":
        p = ext_ports_by_id.get(ep_id)
        return (p["x"], -p["y"]) if p else None
    if ep_type == "port" and ep_comp:
        pm = comp_port_positions.get(ep_comp)
        return pm.get(ep_id) if pm else None
    return None

# --- Phase 2: Wire polygons ---
for wi, wire in enumerate(ofa.get("wires", [])):
    try:
        s = resolve_ep(wire, "start")
        e = resolve_ep(wire, "end")
        if not s or not e:
            continue
        layer_name = wire.get("layer", "Metal1")
        gds_l = layer_gds.get(layer_name)
        if not gds_l:
            errors.append(f"wire[{wi}]: unknown layer '{layer_name}'")
            continue
        ww = wire.get("width", 0.1)
        hw = ww / 2.0
        sx, sy = s
        ex, ey = e
        dx = abs(ex - sx)
        dy = abs(ey - sy)
        if dx < 0.001 and dy < 0.001:
            continue
        if dy < 0.001:
            pts = [(min(sx,ex), sy-hw), (max(sx,ex), sy-hw),
                   (max(sx,ex), sy+hw), (min(sx,ex), sy+hw)]
        elif dx < 0.001:
            pts = [(sx-hw, min(sy,ey)), (sx+hw, min(sy,ey)),
                   (sx+hw, max(sy,ey)), (sx-hw, max(sy,ey))]
        else:
            errors.append(f"wire[{wi}]: non-Manhattan")
            continue
        top.add_polygon(pts, layer=gds_l)
    except Exception as e:
        errors.append(f"wire[{wi}]: {e}")

# --- Phase 3: Via stacks at layer-transition junctions ---
has_via_stack = "via_stack" in factories
for ji, junction in enumerate(ofa.get("junctions", [])):
    try:
        j_id = junction["id"]
        connected_layers = set()
        connected_widths = []
        for wire in ofa.get("wires", []):
            if (wire["startType"] == "junction" and wire["startId"] == j_id) or \
               (wire["endType"] == "junction" and wire["endId"] == j_id):
                connected_layers.add(wire.get("layer", "Metal1"))
                connected_widths.append(wire.get("width", 0.1))
        if len(connected_layers) < 2:
            continue
        idxs = [(LAYER_ORDER.index(l), l) for l in connected_layers if l in LAYER_ORDER]
        if len(idxs) < 2:
            continue
        idxs.sort()
        bottom = idxs[0][1]
        top_l = idxs[-1][1]
        if not has_via_stack:
            errors.append(f"junction[{ji}]: via_stack not in PDK")
            continue
        via_sz = max(connected_widths) if connected_widths else 0.5
        via = gf.get_component(factories["via_stack"],
            bottom_layer=bottom, top_layer=top_l,
            size=(via_sz, via_sz))
        via.locked = False
        via.dmove((-via.xmin, -via.ymin))
        via.locked = True
        via_ref = top.add_ref(via)
        gds_x = junction["x"]
        gds_y = -junction["y"]
        via_ref.move((gds_x - float(via.xsize)/2, gds_y - float(via.ysize)/2))
    except Exception as e:
        errors.append(f"junction[{ji}] via: {e}")

# --- Write GDS ---
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
