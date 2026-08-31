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

For focused Pi orchestration iteration, run the full TypeScript typecheck with orchestration-only lint and behavioral tests:

```sh
cd modules/programs/pi-coding-agent
pnpm check:orchestration
```

This command shortens iteration only; the unscoped `pnpm check` and the full repository gate retain final authority.

Current focused check owners are:

- `pi-customizations`: Pi TypeScript typechecking, linting, and admitted Node behavioral tests;
- `configuration-contracts` on `aarch64-darwin`: cross-owner Nix configuration projection and semantic consumer validation;
- `kanata-configs` on `aarch64-darwin`: pinned Kanata consumer validation of the final Rift-enabled and Rift-disabled generated root configurations;
- `sketchybar-workspace-adapter-tests` on `aarch64-darwin`: workspace-provider normalization behavior;
- `sketchybar-media-hover-tests` on `aarch64-darwin`: media hover state transitions and concurrency;
- `repository-consistency`: repository-owned path, documentation-link, and Skill-package integrity;
- `full-validation-runner-tests`: fake-Nix full-validation inventory and transactional-retention behavior;
- `treefmt`: repository formatting conformance;
- `nixos-seiran-vm0` on `aarch64-linux`: representative NixOS system closure realization.

A Home Manager, nix-darwin, NixOS, host, rice, or shared module change normally needs `configuration-contracts` when its owned projection is exercised there; otherwise use evaluation and the most representative available closure build.

## Full validation

From the repository root, run:

```sh
nix run .#check-full
```

The app first performs structural evaluation with `nix flake check --no-build --no-update-lock-file`, then dynamically enumerates and prints every `checks.<current-system>` name. An empty inventory fails. It builds that complete check inventory and the applicable platform representatives in one realization wave: Darwin adds `seiran`, `seiran-vm1`, and standalone `neo@seiran-clean`; aarch64 Linux relies on its applicable checks; x86_64 Linux evaluates the incompatible aarch64 NixOS representative's `drvPath` without claiming a build passed. It reports elapsed time for every stage and a final total.

A successful realization is retained as a fresh generation below `.direnv/check-full/generations/`, then atomically selected through `.direnv/check-full/current`. A failed realization removes its staging generation and leaves the prior `current` roots intact. The selected generation keeps its closures reusable across automatic garbage collection; a later success removes the former generation.

## Flake source visibility

Flakes only read Git-tracked files. Stage new files before evaluating or building through the flake:

```sh
git add <new-files>
```

Staging is required for source visibility; it does not imply that the change is ready to commit.
