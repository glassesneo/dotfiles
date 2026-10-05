import "./core/runtime-setup";
import { getAgentDir, initTheme } from "@earendil-works/pi-coding-agent";
import { render } from "@opentui/solid";
import { createSessionHost } from "./core/session";
import { createSettingsManager } from "./core/settings";
import { notice } from "./core/session-entries";
import { Screen } from "./ui/screen";

export async function run(options: { configPath: string | undefined }): Promise<void> {
  initTheme();
  const host = await createSessionHost({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    settingsManager: createSettingsManager(options.configPath),
  });

  const startupNotices = [
    ...host.runtime.diagnostics.map((diagnostic) => notice(diagnostic.type, diagnostic.message)),
    ...(host.runtime.modelFallbackMessage
      ? [notice("warning", host.runtime.modelFallbackMessage)]
      : []),
  ];

  await render(() => <Screen host={host} startupNotices={startupNotices} />, {
    // Ctrl+C is the quit action, which disposes the session before exiting.
    exitOnCtrlC: false,
  });
}
