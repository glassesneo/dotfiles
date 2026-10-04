# Architecture

This file owns the structure of the repository: how the configuration is composed, the Denix concepts it relies on, what each directory owns, and which repository mechanisms exist. Everything outside `abstractions/` exists to compose, extend, verify, or apply it, so the model centers on Denix abstractions.

## Composition

`flake.nix` is the composition root. It selects inputs, loads adapters and extensions, discovers Denix abstractions, passes `lib/` to them as `mylib`, and publishes configurations, checks, formatting, and the development shell.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not form manual import chains. New files must be Git-tracked before flake evaluation can discover them.

`flake.nix` publishes one nix-darwin configuration per Darwin host and one Hjem configuration per user of each host. Each configuration evaluates independently because each is activated separately.

The same composition publishes `packages.<system>`, merging feature-owned bundles selected for publication into the flake's own packages. A published name that equals an existing package name fails evaluation instead of overriding it.

## Modules, hosts, and sections

A module (`delib.module`) is a feature. It declares options under `myconfig.<name>` and configuration for each module system. A host (`delib.host`) holds the facts and choices of one machine.

Both write configuration in sections per module system, such as `darwin.ifEnabled` or `hjem.always`:

- `always` applies unconditionally.
- `ifEnabled` applies when the module's `enable` is true, or, for a host, when that host is the one being built.
- `ifDisabled` applies when the module's `enable` is false, or, for a host, when another host is being built.

Option declarations go in `always`; a conditional section cannot declare options.

The module systems are `darwin` (nix-darwin), `hjem` (through `adapters/hjem/default.nix`), `bundles` (feature-owned packages selected for publication, through `adapters/bundles.nix`), and `myconfig`. `myconfig` is not evaluated on its own: Denix merges it into every other module system's evaluation under the `myconfig` prefix. A `myconfig` value is therefore seen by every module system and must mean the same in each. A value that only means something inside one system, such as a path or derivation that system computes, belongs to that system's sections.

A module's name is its `myconfig` interface path, so choose it for the modules and hosts that reference it. Directory placement serves navigation and may differ from the name.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/modules/` owns reusable features. A feature keeps its Darwin, Hjem, and other module-system outputs together.
- `adapters/` owns integrations for module systems that Denix does not provide. An adapter translates Denix modules into the external system's configuration result; it does not own user configuration policy.
- `extensions/` owns extensions of Denix itself: host attributes and behavior applied to every module or host. Features that consume them live in `abstractions/modules/`.
- `lib/` owns pure Nix helpers passed to abstractions as `mylib`. Helpers define types and transformations; they do not own configuration.
- `tests/` owns sandboxed checks exported through `checks.<system>`. Each immediate `tests/<name>/default.nix` is discovered automatically.
- `scripts/` and `justfile` own operator commands; see `docs/commands.md`.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

## Repository mechanisms

Each mechanism is specified at the top of its file and by its option descriptions.

- `extensions/hosts.nix`: host attributes (system, users, primary user), exposed as read-only `myconfig.host` by the host module.
- `extensions/module-dependencies.nix`: a dotted module's `enable` depends on its immediate parent.
- `extensions/module-metadata.nix`: required responsibility descriptions for modules.
- `extensions/provenance.nix`: every module and host section is labelled with its origin as the location of its definitions.
- `adapters/hjem/default.nix`: the Hjem module system, including files that only one location may define.
- `adapters/hjem/services.nix`: Hjem-owned portable/native service declarations and Darwin lowering, with lifecycle reconciliation in `adapters/hjem/services.py`.
- `adapters/hjem/nix-secrets.nix`: standalone compatibility for upstream nix-secrets options and manifest-based Darwin user activation.
- `adapters/bundles.nix`: the bundles module system, through which a feature declares itself as a standalone package; which bundles are published is chosen separately.
- `lib/fragments.nix`: named fragments ordered by dependency, for a file that several features contribute to.
- `lib/module-docs.nix`: a module catalogue rendered from Denix metadata and declaration locations without generating a host configuration.
- `scripts/bun.nu`: npm dependencies of a Bun project pinned for Nix in a `bun.nix` generated from its `bun.lock`, kept current by `tests/bun-lock`.
- `git-hooks.nix`: development-shell installation of commit automation, with the transaction owned by `scripts/commit.nu`.

## Validation boundary

A test belongs under `tests/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. Upstream Denix and Hjem APIs are trusted; checks cover repository-owned adapters and contracts.

Mechanism checks use the smallest input boundary they own, without importing unrelated feature modules or extensions. Checks of feature wiring receive the real Denix `configuration` from `flake.nix` instead of reconstructing its module list.

Live activation and platform behavior require an explicit operator command; evaluation and derivation builds do not exercise them.
