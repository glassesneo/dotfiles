# Nix validation

Use three validation levels so inexpensive flake evaluation remains separate from configuration contracts and representative builds.

## Fast evaluation

Run the cheap evaluation path while iterating:

```sh
nix flake check --no-build --no-update-lock-file
```

This checks the flake output shape and evaluates cheap check derivations. It does not evaluate every Home Manager, nix-darwin, or NixOS configuration derivation.

## Focused build

Inspect available checks before selecting the one owned by the changed area:

```sh
nix flake show
nix build .#checks.<system>.<name> --no-link
```

Common mappings are:

- Pi TypeScript, lint, or Node tests: `pi-customizations`
- Pi Nix projections or any Home Manager, nix-darwin, NixOS, host, rice, or shared module change: `configuration-contracts` on `aarch64-darwin`
- Sketchybar workspace providers: `sketchybar-workspace-adapter-tests`
- Sketchybar media behavior: `sketchybar-media-hover-tests`
- repository-owned paths and links: `repository-consistency`

An unavailable check on an incompatible system is not a successful build. Run it on its owning system or record that only evaluation was performed.

## Full validation

From the repository root, run:

```sh
nix run .#check-full
```

The app builds all checks applicable to the current system. On Darwin it then builds `seiran`, `seiran-vm1`, and the standalone `neo@seiran-everforest` Home Manager configuration and confirms the complete configuration inventory. On aarch64 Linux, the applicable flake check builds `nixos-seiran-vm0`; other systems do not claim that incompatible build passed.

## Flake source visibility

Flakes only read Git-tracked files. Stage new files before evaluating or building through the flake:

```sh
git add <new-files>
```

Staging is required for source visibility; it does not imply that the change is ready to commit.
