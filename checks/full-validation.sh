#!/usr/bin/env bash
set -euo pipefail

system=@system@
validation_started=$SECONDS

stage() {
  printf '\n==> %s\n' "$1" >&2
}

run_stage() {
  local label=$1
  local started=$SECONDS
  local status
  shift

  stage "$label"
  if "$@"; then
    printf '<== %s passed in %ss\n' "$label" "$((SECONDS - started))" >&2
    return 0
  else
    status=$?
    printf '<== %s failed in %ss\n' "$label" "$((SECONDS - started))" >&2
    return "$status"
  fi
}

if [[ ! -f flake.nix ]]; then
  echo "error: run this command from the dotfiles repository root" >&2
  exit 1
fi

root_dir="$PWD/.direnv/check-full"
mkdir -p "$root_dir"

run_stage "build applicable flake checks for $system" \
  nix flake check --no-update-lock-file -L

check_roots=(".#checks.$system.pi-customizations")
retention_label="retain reusable check closures"
case "$system" in
aarch64-darwin)
  check_roots+=(".#checks.$system.configuration-contracts")
  ;;
aarch64-linux)
  check_roots+=(".#checks.$system.nixos-seiran-vm0")
  retention_label="retain reusable check and representative closures"
  ;;
x86_64-linux) ;;
*)
  echo "unsupported system: $system" >&2
  exit 1
  ;;
esac

run_stage "$retention_label" \
  nix build -L --out-link "$root_dir/checks" "${check_roots[@]}"

case "$system" in
aarch64-darwin)
  run_stage "build and retain representative Darwin and standalone Home Manager configurations" \
    nix build -L --out-link "$root_dir/representatives" \
    .#darwinConfigurations.seiran.system \
    .#darwinConfigurations.seiran-vm1.system \
    '.#homeConfigurations."neo@seiran-clean".activationPackage'
  ;;
x86_64-linux)
  run_stage "evaluate the incompatible aarch64-linux NixOS representative without building it" \
    nix eval --raw .#checks.aarch64-linux.nixos-seiran-vm0.drvPath >/dev/null
  ;;
esac

printf '\nFull validation passed for %s in %ss\n' "$system" "$((SECONDS - validation_started))" >&2
