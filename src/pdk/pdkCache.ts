import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { OfaConfig, PdkCellInfo, PdkConnectivityInfo, PdkLayerInfo } from "../types.js";

const CACHE_VERSION = 1;

export interface PdkCacheData {
  cacheVersion: number;
  pdkName: string;
  pdkPackageVersion: string;
  cells: PdkCellInfo[];
  connectivity: PdkConnectivityInfo[];
  layers: PdkLayerInfo[];
}

function getCacheDir(root: string): string {
  return path.join(root, ".ofa-cache");
}

function getCacheFile(root: string, pdkName: string, pdkVersion: string): string {
  const hash = crypto
    .createHash("md5")
    .update(`${pdkName}@${pdkVersion}`)
    .digest("hex")
    .substring(0, 12);
  return path.join(getCacheDir(root), `pdk-${hash}.json`);
}

function getPythonPath(root: string): string {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

export async function getPdkPackageVersion(root: string, config: OfaConfig): Promise<string> {
  const py = getPythonPath(root);
  return new Promise((resolve, reject) => {
    cp.execFile(
      py,
      ["-c", `import importlib.metadata; print(importlib.metadata.version("${config.pdkPackage}"))`],
      { cwd: root, timeout: 10_000 },
      (err, stdout) => {
        if (err) { reject(err); }
        else { resolve(stdout.trim()); }
      }
    );
  });
}

export function readCache(root: string, pdkName: string, pdkVersion: string): PdkCacheData | null {
  const cacheFile = getCacheFile(root, pdkName, pdkVersion);
  if (!fs.existsSync(cacheFile)) { return null; }
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as PdkCacheData;
    if (data.cacheVersion !== CACHE_VERSION) { return null; }
    if (data.pdkPackageVersion !== pdkVersion) { return null; }
    return data;
  } catch {
    return null;
  }
}

export function writeCache(root: string, data: PdkCacheData): void {
  const dir = getCacheDir(root);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const cacheFile = getCacheFile(root, data.pdkName, data.pdkPackageVersion);
  fs.writeFileSync(cacheFile, JSON.stringify(data), "utf-8");
}

export function clearCache(root: string): void {
  const dir = getCacheDir(root);
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}
