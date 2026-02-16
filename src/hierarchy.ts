import * as vscode from "vscode";

export interface HierarchyNode {
  name: string;
  uri: string;
  children: HierarchyNode[];
}

export async function buildDependencyMap(): Promise<Map<string, string[]>> {
  const ofaFiles = await vscode.workspace.findFiles("**/*.ofa");
  const depMap = new Map<string, string[]>();

  for (const fileUri of ofaFiles) {
    const relPath = vscode.workspace.asRelativePath(fileUri);
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const doc = JSON.parse(Buffer.from(raw).toString("utf-8"));
      const includes: string[] = [];
      if (Array.isArray(doc.includes)) {
        for (const inc of doc.includes) {
          if (inc.file && typeof inc.file === "string" && inc.file.endsWith(".ofa")) {
            const dir = relPath.includes("/")
              ? relPath.substring(0, relPath.lastIndexOf("/"))
              : "";
            const resolved = dir ? `${dir}/${inc.file}` : inc.file;
            includes.push(resolved);
          }
        }
      }
      depMap.set(relPath, includes);
    } catch {
      depMap.set(relPath, []);
    }
  }

  return depMap;
}

export function buildHierarchyTree(
  depMap: Map<string, string[]>
): HierarchyNode[] {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;

  function makeNode(relPath: string, visited: Set<string>): HierarchyNode {
    const uri = root
      ? vscode.Uri.joinPath(root, relPath).toString()
      : relPath;
    const children: HierarchyNode[] = [];
    const deps = depMap.get(relPath) ?? [];

    for (const dep of deps) {
      if (visited.has(dep)) {
        children.push({ name: `${dep} (circular)`, uri, children: [] });
        continue;
      }
      visited.add(dep);
      children.push(makeNode(dep, visited));
      visited.delete(dep);
    }

    return { name: relPath, uri, children };
  }

  const nodes: HierarchyNode[] = [];
  for (const relPath of [...depMap.keys()].sort()) {
    nodes.push(makeNode(relPath, new Set([relPath])));
  }
  return nodes;
}
