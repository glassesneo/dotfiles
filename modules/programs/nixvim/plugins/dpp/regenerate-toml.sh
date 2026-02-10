#!/usr/bin/env bash
# Regenerate TOML files from Nickel sources.
# Source of truth: .ncl files. TOML files are generated snapshots.
#
# Usage:
#   nix develop -c bash modules/programs/nixvim/plugins/dpp/regenerate-toml.sh
#
# Drift check (CI/pre-commit):
#   nix develop -c bash modules/programs/nixvim/plugins/dpp/regenerate-toml.sh
#   git diff --exit-code -- modules/programs/nixvim/plugins/dpp/plugins/*.toml

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$SCRIPT_DIR/plugins"
CONTRACT="$PLUGINS_DIR/plugins_contract.ncl"

for ncl_file in "$PLUGINS_DIR"/*.ncl; do
  # Skip the contract file itself
  [[ "$(basename "$ncl_file")" == "plugins_contract.ncl" ]] && continue

  toml_file="${ncl_file%.ncl}.toml"
  echo "Regenerating $(basename "$toml_file") from $(basename "$ncl_file")..."
  nickel export --format toml "$ncl_file" --apply-contract "$CONTRACT" > "$toml_file"
done

echo "Done. All TOML files regenerated."
