import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { EnvironmentStatus, OfaConfig, PdkOption, SUPPORTED_PDKS } from "./types.js";

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getPythonPath(root: string): string {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
}

function exec(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function checkEnvironment(): Promise<EnvironmentStatus> {
  const root = getWorkspaceRoot();
  if (!root) {
    return {
      venvExists: false,
      gdsfactoryInstalled: false,
      configExists: false,
      configValid: false,
    };
  }

  const venvExists = fs.existsSync(path.join(root, ".venv"));

  let gdsfactoryInstalled = false;
  if (venvExists) {
    const py = getPythonPath(root);
    try {
      await exec(`"${py}" -c "import gdsfactory"`, root);
      gdsfactoryInstalled = true;
    } catch {
      gdsfactoryInstalled = false;
    }
  }

  const configPath = path.join(root, "ofa-config.json");
  const configExists = fs.existsSync(configPath);

  let configValid = false;
  let pdk: string | undefined;
  if (configExists) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config: OfaConfig = JSON.parse(raw);
      if (config.pdk && config.pdkPackage) {
        configValid = true;
        pdk = config.pdk;
      }
    } catch {
      configValid = false;
    }
  }

  return { venvExists, gdsfactoryInstalled, configExists, configValid, pdk };
}

async function ensureUv(root: string): Promise<void> {
  try {
    await exec("uv --version", root);
  } catch {
    // uv not found — install it
    if (process.platform === "win32") {
      await exec("powershell -ExecutionPolicy Bypass -c \"irm https://astral.sh/uv/install.ps1 | iex\"", root);
    } else {
      await exec("curl -LsSf https://astral.sh/uv/install.sh | sh", root);
    }
    // Verify installation
    try {
      await exec("uv --version", root);
    } catch {
      throw new Error("Failed to install uv. Please install it manually: https://docs.astral.sh/uv/");
    }
  }
}

export async function initializeEnvironment(
  pdk: PdkOption,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error("No workspace folder open");
  }

  // Step 1: Ensure uv is installed
  progress.report({ message: "Checking for uv...", increment: 0 });
  await ensureUv(root);

  // Step 2: Create .venv
  progress.report({ message: "Creating Python 3.12 virtual environment...", increment: 20 });
  await exec("uv venv .venv --python 3.12", root);

  // Step 3: Install gdsfactory
  progress.report({ message: "Installing gdsfactory...", increment: 20 });
  const pip = process.platform === "win32"
    ? `uv pip install gdsfactory --python "${path.join(root, ".venv", "Scripts", "python.exe")}"`
    : `uv pip install gdsfactory --python "${path.join(root, ".venv", "bin", "python")}"`;
  await exec(pip, root);

  // Step 4: Install PDK package
  progress.report({ message: `Installing ${pdk.label} PDK...`, increment: 20 });
  const pdkPip = process.platform === "win32"
    ? `uv pip install ${pdk.pipPackage} --python "${path.join(root, ".venv", "Scripts", "python.exe")}"`
    : `uv pip install ${pdk.pipPackage} --python "${path.join(root, ".venv", "bin", "python")}"`;
  await exec(pdkPip, root);

  // Step 5: Write ofa-config.json
  progress.report({ message: "Writing configuration...", increment: 20 });
  const config: OfaConfig = {
    pdk: pdk.id,
    pdkPackage: pdk.pipPackage,
    pythonImport: pdk.pythonImport,
  };
  fs.writeFileSync(
    path.join(root, "ofa-config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  progress.report({ message: "Done!", increment: 20 });
}

export async function selectAndInitializePdk(): Promise<boolean> {
  const items = SUPPORTED_PDKS.map((p) => ({
    label: p.label,
    description: p.description,
    pdk: p,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Choose a PDK",
    title: "One-For-All: Select PDK",
  });

  if (!picked) {
    return false;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "One-For-All: Initializing environment",
        cancellable: false,
      },
      async (progress) => {
        await initializeEnvironment(picked.pdk, progress);
      }
    );
    vscode.window.showInformationMessage(
      `One-For-All: Environment initialized with ${picked.label} PDK`
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`One-For-All: Initialization failed — ${msg}`);
    return false;
  }
}
