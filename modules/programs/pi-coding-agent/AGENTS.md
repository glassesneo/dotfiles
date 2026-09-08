# modules/programs/pi-coding-agent/

## Responsibility Boundaries

- `prompts/` owns thin explicit Pi entrypoints. Prompt templates never change the active mode.
- Role definitions own mandatory role behavior and role-specific use of Pi resources. Reusable Skills own optional harness-independent methods. Extensions and tool guidance own Pi process, task, tmux, ACP, popup, event, and tool-schema mechanics.
- `extensions/mode/` and `extensions_src/mode.ts` own mutable top-level `recon`/`ops` state. Child processes never load mode controls.
- `extensions/orchestration/` owns peer-mesh mechanics: root-owned epochs, task and event state, harness adapters, and the agent popup view.
- `extensions/popup/` owns the single overlay lifecycle and registered view stack; consumers provide views but do not open competing root overlays.
- `default.nix` is the sole ordered default-extension aggregator. The supported core order is popup, mode, orchestration, command palette.
- `keybindings/default.nix` is the sole final writer for Pi and repository extension keybindings.
- Keep Pi's default system prompt and native resource discovery. Put concise mode and agent additions in extension hooks rather than a custom system prompt.

## Local Contract

- Treat schemas, required `access`, selector uniqueness, one-profile edges, unknown-reference rejection, Pi-only outbound callers, and prompt-only leaves as feature mechanics. Treat selected models, thinking levels, role assignments, budgets, GC, Web weights, and Cursor ACP mappings as mutable user policy unless a nearby invariant says otherwise.
- Public `selector.agent` is the call name; the `roles` attribute key is the internal role ID. Resolve authority from the configured selector, callPolicy, and explicit restrictions, not from a public name.
