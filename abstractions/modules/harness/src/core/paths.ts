import { homedir } from "node:os";
import { join } from "node:path";

/** The harness's own pi agent directory, kept apart from pi's `~/.pi/agent`. */
export function agentDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "harness");
}
