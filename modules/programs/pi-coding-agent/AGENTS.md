# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin explicit Pi entrypoints. Prompt templates never change the active mode.
- Reusable Skills own model-facing capability procedures; extensions own Pi process, task, tmux, ACP, popup, event, and tool-schema mechanics.
- `extensions/mode/` and `extensions_src/mode.ts` own mutable top-level `recon`/`ops` state. Child processes never load mode controls.
- `extensions/orchestration/` owns the immutable agent catalog, delegation authorization, launch envelopes, task state, harness adapters, and agent-session popup view.
- `extensions/popup/` owns the single overlay lifecycle and registered view stack; consumers provide views but do not open competing root overlays.
- `default.nix` is the sole ordered default-extension aggregator. The supported core order is popup, mode, orchestration, command palette.
- `keybindings/default.nix` is the sole final writer for Pi and repository extension keybindings.
- Keep Pi's default system prompt and native resource discovery. Put concise mode and agent additions in extension hooks rather than a custom system prompt.
