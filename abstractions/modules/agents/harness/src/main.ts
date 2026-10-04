import { parseArgs } from "node:util";
import { agentDir } from "./core/paths";

declare const HARNESS_VERSION: string;
declare const PI_VERSION: string;

const { values } = parseArgs({
  options: {
    version: { type: "boolean" },
    config: { type: "string" },
  },
});

// pi and third-party extensions call getAgentDir(), which reads this variable,
// instead of receiving the SDK's agentDir option; set it before pi is loaded.
process.env.PI_CODING_AGENT_DIR = agentDir();

// Loading the app also for --version lets the package's install check catch a
// binary whose bundled pi modules fail to load, without needing a terminal.
const { run } = await import("./app");

if (values.version) {
  console.log(`harness ${HARNESS_VERSION} (pi ${PI_VERSION})`);
} else {
  await run({ configPath: values.config });
}
