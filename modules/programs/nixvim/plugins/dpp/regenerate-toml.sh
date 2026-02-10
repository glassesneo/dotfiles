#!/usr/bin/env bash
# Regenerate TOML files from Nickel sources.
# Source of truth: .ncl files. TOML files are generated artifacts.
#
# Usage:
#   nix develop -c bash modules/programs/nixvim/plugins/dpp/regenerate-toml.sh
#
# Optional helper for local/manual TOML regeneration.
# Generated TOML may remain untracked in git.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$SCRIPT_DIR/plugins"
CONTRACT="$PLUGINS_DIR/plugins_contract.ncl"

# Auto-discovery convention (aligned with Nix generation):
# - Include only plugin source files named `^[a-z0-9-]+\.ncl$`.
# - Explicitly exclude non-plugin files (contract, fixtures, scratch).
# - WARNING: Any scratch `.ncl` matching the pattern will be exported.
readonly NCL_PATTERN='^[a-z0-9-]+\.ncl$'
readonly EXCLUDED_NCL_FILES=("plugins_contract.ncl")

LC_ALL=C
export LC_ALL
shopt -s nullglob

for ncl_file in "$PLUGINS_DIR"/*.ncl; do
  file_name="$(basename "$ncl_file")"

  [[ ! "$file_name" =~ $NCL_PATTERN ]] && continue

  skip_file=false
  for excluded in "${EXCLUDED_NCL_FILES[@]}"; do
    if [[ "$file_name" == "$excluded" ]]; then
      skip_file=true
      break
    fi
  done
  [[ "$skip_file" == true ]] && continue

  toml_file="${ncl_file%.ncl}.toml"
  echo "Regenerating $(basename "$toml_file") from $(basename "$ncl_file")..."
  nickel export --format toml "$ncl_file" --apply-contract "$CONTRACT" > "$toml_file"
done

echo "Done. All TOML files regenerated."
