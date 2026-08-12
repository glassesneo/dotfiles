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
    '.#homeConfigurations."neo@seiran-clean".activationPackage'

  ;;
aarch64-linux)
  stage "aarch64-linux representative was built by the applicable flake check"
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
