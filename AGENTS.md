# Repository Guidelines

## Project Structure & Module Organization
- `flake.nix`, `flake.lock`, and `modules/` form the declarative backbone. `modules/programs` hosts reusable program configs, `modules/toplevel` covers system-wide options, and `modules/config` wires together host-specific overlays.
- `var/`, `hosts/`, and `secrets/` hold target-specific data: `hosts/` defines machine metadata, `secrets/` stores age-encrypted keys referenced via `config.age.secrets`, and `var/` keeps generated artifacts.
- `node2nix/` manages custom Node package inputs used by MCP servers; update `node2nix/node-packages.json` before adjusting related `modules/config/node2nix.nix` expressions.

## Build, Test, and Development Commands
- `nh darwin switch . --hostname kurogane -Lt` — build+activate the nix-darwin + Home Manager profile for the `kurogane` host, showing trace output on errors. Use `--dry`/`--ask` for previews.
- `nh home switch` (or `nh home switch .#neo`) — rebuild the Home Manager profile without touching system-level darwin code.
- `nh clean all --keep 5` — garbage-collect generations while keeping recent builds; `nh clean user`/`nh clean profile` target narrower scopes.
- `nix develop` — drop into the development shell defined by the flake (provides deno, lsp tooling, etc.).
- `nix flake check` — run all enabled checks; use after edits and before commits to validate syntax and evaluations.
- `nix flake update` — refresh inputs; follow with `git add flake.lock` and a commit referencing the new versions.

## Coding Style & Naming Conventions
- Nix modules use two-space indentation and multi-line attribute sets with `name = value;` blocks. Keep `delib.module` options grouped by category and guard with `ifEnabled` helpers (`home.ifEnabled`, `darwin.ifEnabled`).
- File names mirror their purpose: `modules/programs/<program>/default.nix` for program modules, `modules/toplevel/<topic>.nix` for cross-cutting concerns, and `hosts/<hostname>.nix` for host-specific overrides.
- When referencing secrets, use `config.age.secrets.<key>.path` rather than hard-coded values; keep comments concise and functional.

## Testing Guidelines
- Primary framework is the Nix flake check suite (`nix flake check`). Run locally after modifying modules or dependencies.
- Dry-run configurations with `nh home switch --dry` and `nh darwin switch . -H kurogane -Lt --dry` before applying system-level changes.
- Name new tests or scripts after the module/pattern they cover and link them in the flake outputs if needed.

## Commit & Pull Request Guidelines
- Follow conventional commits: `feat:`, `fix:`, and `chore:` prefixes are common, with `update:` reserved for dependency bumps. Keep messages short, imperative, and scoped when practical.
- Pull requests should include a brief summary, testing steps (or `nix flake check` status), any relevant issue links, and screenshots only when the change affects user-visible UI.

## Secrets & Configuration Tips
- Modify `secrets/*.age` with `agenix` and commit only the encrypted blobs; avoid plaintext keys.
- Keep MCP server credentials in `secrets/` and reference them through environment variables defined in `modules/toplevel/secrets.nix`.
