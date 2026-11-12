import { build } from "esbuild";

// One self-contained file (workspace packages and zod bundled in): `node dist/main.js` runs it
// on the runner's Mac with nothing else installed. The platform's scripts are loaded at run time
// from the platform checkout at the task's commit, never bundled.
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/main.js",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
