import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { render, useKeyboard, useRenderer } from "@opentui/solid";

declare const HARNESS_VERSION: string;
declare const PI_VERSION: string;

const version = `harness ${HARNESS_VERSION} (pi ${PI_VERSION})`;

if (process.argv.includes("--version")) {
  // Evaluating the SDK here lets the package's install check catch a binary
  // whose bundled pi modules fail to load, without needing a terminal.
  if (typeof createAgentSession !== "function") {
    throw new Error("pi SDK did not load");
  }
  console.log(version);
  process.exit(0);
}

function App() {
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy();
    }
  });

  return (
    <box border padding={1} flexDirection="column">
      <text>{version}</text>
      <text>Press q to quit.</text>
    </box>
  );
}

render(() => <App />);
