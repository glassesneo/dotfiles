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
generations_dir="$root_dir/generations"
current_link="$root_dir/current"
pending_generation=""
pending_current=""
check_names=()
installables=()

cleanup_pending_generation() {
  local status=$?

  if ((status != 0)); then
    [[ -z $pending_current ]] || rm -f "$pending_current"
    [[ -z $pending_generation ]] || rm -rf "$pending_generation"
  fi

  return "$status"
}
trap cleanup_pending_generation EXIT

inventory_checks() {
  local inventory

  if ! inventory=$(nix eval --no-update-lock-file --raw --apply 'checks: builtins.concatStringsSep "\n" (map builtins.toJSON (builtins.attrNames checks))' ".#checks.$system"); then
    return 1
  fi

  if [[ -z $inventory ]]; then
    echo "error: no flake checks were found for $system" >&2
    return 1
  fi

  mapfile -t check_names <<<"$inventory"
  printf 'Discovered %d flake checks for %s:\n' "${#check_names[@]}" "$system" >&2
  printf '  %s\n' "${check_names[@]}" >&2
}

realize_and_retain() {
  local generation_name
  local generation_dir
  local former_target=""

  if [[ -e $current_link && ! -L $current_link ]]; then
    echo "error: $current_link must be a symlink" >&2
    return 1
  fi

  if ! pending_generation=$(mktemp -d "$generations_dir/generation-XXXXXXXX"); then
    return 1
  fi
  if ! nix build --no-update-lock-file -L --out-link "$pending_generation/result" "${installables[@]}"; then
    return 1
  fi

  generation_dir="$pending_generation"
  generation_name="${generation_dir##*/}"

  if [[ -L $current_link ]] && ! former_target=$(readlink "$current_link"); then
    return 1
  fi

  pending_current="$root_dir/.current.$generation_name"
  if ! ln -s "generations/$generation_name" "$pending_current"; then
    return 1
  fi
  if ! mv -Tf "$pending_current" "$current_link"; then
    return 1
  fi
  pending_current=""
  pending_generation=""

  if [[ $former_target =~ ^generations/[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && ! rm -rf -- "${root_dir:?}/${former_target:?}"; then
    return 1
  fi
}

mkdir -p "$generations_dir"

run_stage "structural flake evaluation" \
  nix flake check --no-build --no-update-lock-file
run_stage "inventory applicable flake checks for $system" inventory_checks

for check_name in "${check_names[@]}"; do
  installables+=(".#checks.$system.$check_name")
done

case "$system" in
aarch64-darwin)
  installables+=(
    .#darwinConfigurations.seiran.system
    .#darwinConfigurations.seiran-vm1.system
    '.#homeConfigurations."neo@seiran-clean".activationPackage'
  )
  ;;
aarch64-linux)
  ;;
x86_64-linux)
  run_stage "evaluate the incompatible aarch64-linux NixOS representative without building it" \
    nix eval --no-update-lock-file --raw .#checks.aarch64-linux.nixos-seiran-vm0.drvPath >/dev/null
  ;;
*)
  echo "unsupported system: $system" >&2
  exit 1
  ;;
esac

run_stage "realize and retain ${#installables[@]} applicable checks and representatives" \
  realize_and_retain

printf '\nFull validation passed for %s in %ss\n' "$system" "$((SECONDS - validation_started))" >&2
