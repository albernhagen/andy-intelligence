import { build } from "esbuild";

// Bundle our TS workspace packages (@andy/*); leave npm deps external —
// they're installed in the runtime image via `pnpm deploy`.
const externalizeNpm = {
  name: "externalize-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@andy/") ? undefined : { path: args.path, external: true },
    );
  },
};

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/main.js",
  sourcemap: true,
  plugins: [externalizeNpm],
});
