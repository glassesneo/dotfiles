#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

tmp_dir="$(mktemp -d)"
tmp_dir="$(cd "${tmp_dir}" && pwd -P)"
stderr_file="$(mktemp)"

cleanup() {
  rm -rf "${tmp_dir}"
  rm -f "${stderr_file}"
}
trap cleanup EXIT

fixture_repo="${tmp_dir}/repo"
rsync -a \
  --exclude ".git" \
  --exclude ".kiri" \
  --exclude "result" \
  --exclude "result-*" \
  "${repo_root}/" \
  "${fixture_repo}/"

servers_file="${fixture_repo}/nickel/mcp-servers/servers.ncl"

python3 - "${servers_file}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

old = 'command_id = "readability-mcp",'
new = 'command_id = "missing-readability-command",'

if old not in text:
    raise SystemExit("expected fixture marker not found in servers.ncl")

path.write_text(text.replace(old, new, 1))
PY

expected_message='MCP server `readability` needs_node invariant failed'
eval_expr="let flake = builtins.getFlake (toString ${fixture_repo}); in flake.homeConfigurations.\"neo@kurogane\".config.programs.codex.settings.mcp_servers"

if nix eval --impure --json --expr "${eval_expr}" > /dev/null 2>"${stderr_file}"; then
  echo "FAIL: Nix eval succeeded; expected assertion failure"
  exit 1
elif rg --fixed-strings --quiet "${expected_message}" "${stderr_file}"; then
  echo "PASS: Nix eval failed with expected assertion message"
else
  echo "FAIL: Nix eval failed without expected assertion message"
  echo "      expected substring: ${expected_message}"
  exit 1
fi
