import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const extensionOpts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: !watch,
};

/** @type {esbuild.BuildOptions} */
const webviewOpts = {
  entryPoints: ["src/canvas/canvasScript.ts"],
  bundle: true,
  outfile: "dist/canvasScript.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify: !watch,
};

if (watch) {
  const [ctx1, ctx2] = await Promise.all([
    esbuild.context(extensionOpts),
    esbuild.context(webviewOpts),
  ]);
  await Promise.all([ctx1.watch(), ctx2.watch()]);
  console.log("[esbuild] watching...");
} else {
  await Promise.all([
    esbuild.build(extensionOpts),
    esbuild.build(webviewOpts),
  ]);
  console.log("[esbuild] build complete");
}
