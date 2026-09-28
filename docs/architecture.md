# Architecture

This file is the canonical description of repository structure and command ownership.

## Composition and discovery

`flake.nix` is the composition root. It selects inputs, loads adapters, discovers Denix abstractions, and publishes configurations, checks, formatting, and the development shell.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not form manual import chains. New files must be Git-tracked before flake evaluation can discover them.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/modules/` owns reusable features. A feature keeps its Darwin, Hjem, and other module-system outputs together.
- `adapters/` owns integrations for module systems that Denix does not provide. An adapter translates Denix modules into the external system's configuration result; it does not own user configuration policy.
- `tests/` owns sandboxed checks exported through `checks.<system>`. Each immediate `tests/<name>/default.nix` is discovered automatically.
- `scripts/` owns effectful procedures that coordinate commands or mutate user or system state.
- `justfile` exposes short operator commands and delegates their procedures to Nix or `scripts/`.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

## Command boundary

Nix owns evaluation and realization. Build recipes call Nix directly and do not modify user or system state. Effectful procedures belong in Nushell and are invoked through `justfile`.

Standalone Hjem commands select `hjemConfigurations."<user>@<host>"`. Its `preflight` derivation realizes the configuration's sources and packages. `build-hjem` builds only that derivation, while `switch-hjem` continues with activation:

1. Build the selected configuration's `preflight` derivation and retain it with a temporary GC root.
2. Run `hjem standalone switch` for the same `<user>@<host>` output.
3. Remove the temporary root after Hjem exits.

A preflight failure occurs before activation and leaves the existing home unchanged. Hjem activation itself is not transactional; a failure during activation may leave partial changes.

Recipes name the operation they perform and require an explicit host. Hjem recipes default the user to `$USER` and permit an explicit user override. Add Darwin or composed recipes only when their implementations exist.

## Validation boundary

A test belongs under `tests/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. Upstream Denix and Hjem APIs are trusted; checks cover repository-owned adapters and contracts.

Live activation and platform behavior require an explicit operator command. They are not reported as validated merely because evaluation or a derivation build succeeded.
