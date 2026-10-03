# Repository Agent Guidance

This file owns the agent rules no other document covers and summarizes the concepts of `docs/architecture.md` that conversations assume.

## Concepts

- The configuration is built with Denix. Modules (`delib.module`) are features under `abstractions/modules/`; hosts (`delib.host`) are machines under `abstractions/hosts/`. Denix discovers them; they do not import each other.
- A module declares options under `myconfig.<name>`, and its name is that interface path. A dotted module such as `zsh.interactive` is enabled only when its parent is.
- Modules and hosts write configuration in sections per module system: `always`, `ifEnabled`, and `ifDisabled`. The module systems are `darwin` (nix-darwin), `hjem` (user files, through `adapters/hjem.nix`), and `myconfig`.
- `myconfig` is merged into every module system's evaluation, so it carries choices that mean the same everywhere. Values one system computes stay in that system's sections.
- A feature keeps all of its module-system outputs together, and every shared output has one owner. Files several features contribute to are owned by one module and receive the others' contributions as ordered fragments.

## Reading Path

1. Read `docs/architecture.md` before adding a module or host, changing how modules relate, or changing `flake.nix`, `adapters/`, `extensions/`, `lib/`, or `tests/`. Changing a value inside an existing module needs only the concepts above.
2. Read `docs/documentation-policy.md` before changing documentation, comments, or option descriptions, and before completing a change to a repository mechanism or command.
3. Read `docs/commands.md` before changing `justfile`, `just/`, or `scripts/`.

## Validation

1. Stage new files before evaluation; flakes read only Git-tracked files.
2. Run `nix fmt`, then the narrowest relevant check: `nix build .#checks.<system>.<name>` for `tests/<name>`.
3. Before completion, run `nix flake check`.

Report any check or live behavior that was not run as not run, with the reason.
