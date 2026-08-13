# Nix validation

This document owns the repository-specific validation policy for Nix and dotfiles changes. Use the `behavioral-test-design` Skill to decide whether a durable behavioral test is warranted; this document selects the lowest repository mechanism that can observe the material failure.

## Validation ladder

Escalate only until the failure is reliably observable. Multiple layers are justified only when they detect different failure concerns.

1. **Declaration validation** — Nix option types and narrow module assertions reject invalid input and enforce universal relationships every consumer must satisfy.
2. **Evaluation** — flake and output evaluation checks expression validity and explicitly forced configuration surfaces.
3. **Realization or semantic consumer validation** — targeted builds, generated-artifact parsers, upstream check commands, and representative configuration closures validate realized outputs.
4. **Repository-owned behavior** — focused tests cover scripts, parsers, adapters, protocols, state transitions, persistence, cancellation, and other executable behavior not established by lower layers.
5. **Runtime or system observation** — platform-appropriate smoke or integration checks observe activation, permissions, services, networking, GUI or hardware behavior, and other live effects.

Exact defaults, complete inventories, retired-name absence, disablement, and generated text are not automatically compatibility contracts. Retain them only when an active documented consumer commitment exists and no lower semantic validation expresses it. Prefer a real consumer parser or checker over a text snapshot.

A flake evaluation does not force every Home Manager, nix-darwin, or NixOS configuration, and realizing a derivation does not prove live runtime behavior. Record an unavailable platform check as unavailable rather than passed.

## Daily entrypoints

The root `justfile` provides thin names for Nix-owned commands:

| Recipe | Nix command |
|---|---|
| `just fmt` | `nix fmt` |
| `just eval` | `nix flake check --no-build --no-update-lock-file` |
| `just check <flake-check-name>` | `nix build --no-link .#checks.<current-system>.<flake-check-name>` |
| `just full` | `nix run .#check-full` |

Run them without global Just or Nushell installations through the Darwin development shell, for example `nix develop .#dotfiles --command just eval`. Check selection and platform availability remain Nix responsibilities; selecting an unavailable system-specific check fails with Nix's normal attribute error.

## Focused validation

Use the narrowest applicable command while iterating:

```sh
nix flake check --no-build --no-update-lock-file
nix flake show
nix build .#checks.<system>.<name> --no-link
```

Current focused check owners are:

- `pi-customizations`: Pi TypeScript typechecking, linting, and admitted Node behavioral tests;
- `configuration-contracts` on `aarch64-darwin`: cross-owner Nix configuration projection and semantic consumer validation;
- `sketchybar-workspace-adapter-tests` on `aarch64-darwin`: workspace-provider normalization behavior;
- `sketchybar-media-hover-tests` on `aarch64-darwin`: media hover state transitions and concurrency;
- `repository-consistency`: repository-owned path, documentation-link, and Skill-package integrity;
- `treefmt`: repository formatting conformance;
- `nixos-seiran-vm0` on `aarch64-linux`: representative NixOS system closure realization.

A Home Manager, nix-darwin, NixOS, host, rice, or shared module change normally needs `configuration-contracts` when its owned projection is exercised there; otherwise use evaluation and the most representative available closure build.

## Full validation

From the repository root, run:

```sh
nix run .#check-full
```

The app builds all checks applicable to the current system once. On Darwin it then builds `seiran`, `seiran-vm1`, and the standalone `neo@seiran-clean` Home Manager configuration. On aarch64 Linux, the applicable flake check builds `nixos-seiran-vm0`; other systems evaluate that incompatible derivation without claiming its build passed.

## Flake source visibility

Flakes only read Git-tracked files. Stage new files before evaluating or building through the flake:

```sh
git add <new-files>
```

Staging is required for source visibility; it does not imply that the change is ready to commit.
