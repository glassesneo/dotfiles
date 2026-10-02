# Architecture

This file is the canonical description of repository structure and command ownership.

## Composition and discovery

`flake.nix` is the composition root. It selects inputs, loads adapters and extensions, discovers Denix abstractions, and publishes configurations, checks, formatting, and the development shell.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not form manual import chains. New files must be Git-tracked before flake evaluation can discover them.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/modules/` owns reusable features. A feature keeps its Darwin, Hjem, and other module-system outputs together.
- `adapters/` owns integrations for module systems that Denix does not provide. An adapter translates Denix modules into the external system's configuration result; it does not own user configuration policy.
- `extensions/` owns extensions of the Denix configuration schema, such as additional host attributes. Extensions declare structure; features that consume it live in `abstractions/modules/`.
- `tests/` owns sandboxed checks exported through `checks.<system>`. Each immediate `tests/<name>/default.nix` is discovered automatically.
- `scripts/` owns effectful procedures that coordinate commands or mutate user or system state.
- `justfile` exposes short operator commands and delegates their procedures to Nix or `scripts/`.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

A module's name is its `myconfig` interface path, so choose it for the modules and hosts that reference it. Directory placement serves navigation and may differ from the name.

`extensions/module-dependencies.nix` derives enable dependencies from module names. A dotted module depends only on its immediate parent (for example, `zsh.interactive` depends on `zsh`) when that parent is registered and both have an `enable` option. The child's declared default becomes its original condition AND the parent's enable value. Explicit child overrides are preserved; an enabled child with a disabled parent fails through the shared assertions in Darwin and Hjem. Missing parents and modules without `enable` are skipped; the extension does not search for more distant ancestors or gate unconditional outputs.

## Host facts and shared values

Hosts declare their Nix system, their users with home directories, and their primary user through `extensions/hosts.nix`. These attributes are the single source for those facts: `flake.nix` publishes one Darwin configuration per Darwin host and one Hjem configuration per host user from them, and modules read them through the read-only `myconfig.host`.

Each module-system configuration evaluates independently because each is activated separately. A value needed by several module systems comes from `myconfig.host` or from bindings inside the feature that owns it. Checks under `tests/` verify consistency across module systems.

## Command boundary

Nix owns evaluation and realization. Build recipes call Nix directly and do not modify user or system state. Effectful procedures belong in Nushell and are invoked through `justfile`.

Operator commands follow `just <layer> <operation> [host]`. Each layer is a `just` module under `just/`: `hjem` and `darwin` address one module system, and `all` applies every layer of the host in order. The operations are `build` and `switch`.

- `build` realizes the layer without touching any state: Hjem's `preflight` derivation for `$USER`, the nix-darwin `system`, or both for `all`.
- `switch` delegates to `scripts/apply.nu`, which holds temporary GC roots for everything it realizes and removes them when it exits.
- `all switch` applies nix-darwin before Hjem and stops at the first failure.

An omitted host means this machine, resolved with `hostname -s`; the `hostname` module keeps the system name equal to the Denix host name. `switch` applies to `--target` over SSH when it is given, and locally when the host is this machine; any other host without `--target` is an error. Hosts carry no SSH destinations, so one configuration can be applied to any machine that accepts it. A remote switch builds everything locally, copies the closures and the flake source over `ssh-ng` without signature checks, and activates over SSH. Hjem is applied for the SSH user there and for `$USER` locally.

A Hjem preflight failure occurs after nix-darwin activation during `all switch`, but before Hjem activation, and leaves the existing home unchanged. Hjem activation itself is not transactional; a failure during activation may leave partial changes. Snapshots of virtual machines are outside this interface.

## Validation boundary

A test belongs under `tests/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. Upstream Denix and Hjem APIs are trusted; checks cover repository-owned adapters and contracts.

Live activation and platform behavior require an explicit operator command. They are not reported as validated merely because evaluation or a derivation build succeeded.
