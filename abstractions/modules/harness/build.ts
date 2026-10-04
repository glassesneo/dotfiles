// `bun build` cannot load the Solid JSX transform from the command line, so the
// executable is compiled through Bun.build with the OpenTUI Solid plugin.
import solidPlugin from "@opentui/solid/bun-plugin";
import pi from "./node_modules/@earendil-works/pi-coding-agent/package.json" with {
  type: "json",
};
import harness from "./package.json" with { type: "json" };

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  target: "bun",
  plugins: [solidPlugin],
  minify: true,
  sourcemap: "linked",
  // A compiled pi reads its own package.json beside the executable at run
  // time, so the version is fixed here instead.
  define: {
    HARNESS_VERSION: JSON.stringify(harness.version),
    PI_VERSION: JSON.stringify(pi.version),
  },
  // The executable runs in arbitrary project directories, whose Bun
  // configuration must not change it.
  compile: {
    outfile: `./${harness.name}`,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
