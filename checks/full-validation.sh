#!/usr/bin/env bash
set -euo pipefail

system=@system@

stage() {
  printf '\n==> %s\n' "$1" >&2
}

stage "build applicable flake checks for $system"
nix flake check --no-update-lock-file

case "$system" in
aarch64-darwin)
  stage "build representative Darwin and standalone Home Manager configurations"
  nix build --no-link \
    .#darwinConfigurations.seiran.system \
    .#darwinConfigurations.seiran-vm1.system \
    '.#homeConfigurations."neo@seiran-everforest".activationPackage'

  stage "confirm the complete configuration inventory"
  contract=$(nix build --no-link --print-out-paths .#checks.aarch64-darwin.configuration-contracts)
  test -s "$contract/inventory.json"
  ;;
aarch64-linux)
  stage "confirm the aarch64-linux NixOS representative was built by flake check"
  nix build --no-link .#checks.aarch64-linux.nixos-seiran-vm0
  ;;
x86_64-linux)
  stage "evaluate the incompatible aarch64-linux NixOS representative without building it"
  nix eval --raw .#checks.aarch64-linux.nixos-seiran-vm0.drvPath >/dev/null
  ;;
*)
  echo "unsupported system: $system" >&2
  exit 1
  ;;
esac

printf '\nFull validation passed for %s\n' "$system" >&2
