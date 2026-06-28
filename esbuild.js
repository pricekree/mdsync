const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  sourcemap: false,
  minify: true,
}).catch(() => process.exit(1));