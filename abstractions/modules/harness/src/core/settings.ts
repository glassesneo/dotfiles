import { readFileSync } from "node:fs";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * User-level settings come only from the file given with `--config`, built by
 * Nix; changes made while running stay in memory. Project settings are not
 * read because project trust is not implemented.
 */
export function createSettingsManager(configPath: string | undefined): SettingsManager {
  const settings = configPath ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
  return SettingsManager.inMemory(settings, { projectTrusted: false });
}
