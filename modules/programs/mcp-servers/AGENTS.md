# modules/programs/mcp-servers/

## Ownership

- This module owns the typed shared server catalog, target adapters, rendering, and consistency assertions.
- Each supported client module owns its membership in `programs.mcp-servers-nix.targets.<target>` via `myconfig.ifEnabled`; do not centralize client policy here.
- Keep per-client runtime state isolated when adapting a stateful server.

## Secret-Aware Wrappers

- Inject env-var-only server secrets through wrapper commands owned by this module.
- Read secret values from `config.sops.secrets.<name>.path`; do not rely on global session exports or embed secret values in rendered configuration.
