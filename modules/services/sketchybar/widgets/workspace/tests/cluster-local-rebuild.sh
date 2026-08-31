#!/usr/bin/env bash
set -euo pipefail

# Admission: the repository owns SketchyBar workspace item placement relative to
# other left-side widgets; side-tail --add after remove pushes workspace.* past
# later widgets (e.g. notifications), and Nix evaluation cannot observe runtime
# command ordering. Given a successful AeroSpace snapshot render, SketchyBar
# observes each workspace.* added then moved after only workspace-owned anchors
# (workspaces-listener or a prior workspace.*), never after foreign widgets.
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

fixture_dir=$(cd "$(dirname "$0")" && pwd)/fixtures
mkdir -p "$test_root/bin" "$test_root/config/widgets/workspace/providers" "$test_root/state"
export COMMANDS_FILE="$test_root/sketchybar-commands"

cat >"$test_root/bin/sketchybar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '<%s>' "$@" >>"$COMMANDS_FILE"
printf '\n' >>"$COMMANDS_FILE"
EOF

cat >"$test_root/bin/aerospace" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ " \$* " == *" --focused "* ]]; then
  printf '1\n'
  exit 0
fi
if [[ " \$* " == *" --json "* ]]; then
  cat "$fixture_dir/aerospace-workspaces.json"
  exit 0
fi
echo "unexpected aerospace args: \$*" >&2
exit 1
EOF
chmod +x "$test_root/bin/sketchybar" "$test_root/bin/aerospace"

cat >"$test_root/config/colors.nu" <<'EOF'
export const text_primary = "0xffffffff"
export const workspace_active = "0xffffffff"
EOF

cp ../providers/aerospace.nu "$test_root/config/widgets/workspace/providers/aerospace.nu"
cp ../providers/rift.nu "$test_root/config/widgets/workspace/providers/rift.nu"
sed \
  -e 's|@backend@|aerospace|g' \
  -e "s|@aerospace-exe@|$test_root/bin/aerospace|g" \
  -e "s|@rift-cli@|$test_root/bin/rift-cli|g" \
  -e "s|__script_path__|$test_root/config/widgets/workspace/script|g" \
  ../handler.nu >"$test_root/config/widgets/workspace/handler.nu"

HOME="$test_root" \
  XDG_STATE_HOME="$test_root/state" \
  PATH="$test_root/bin:$PATH" \
  nu "$test_root/config/widgets/workspace/handler.nu" render left

grep -Fq '<--add><item><workspace.1><left><--move><workspace.1><after><workspaces-listener>' "$COMMANDS_FILE" \
  || { echo 'workspace.1 must be moved after workspaces-listener in the same add transaction' >&2; exit 1; }
grep -Fq '<--add><item><workspace.A><left><--move><workspace.A><after><workspace.1>' "$COMMANDS_FILE" \
  || { echo 'workspace.A must be moved after workspace.1 in the same add transaction' >&2; exit 1; }

if grep -E '<--move><workspace\.[^>]+><after><' "$COMMANDS_FILE" | grep -vE '<after><(workspaces-listener|workspace\.)'; then
  echo 'workspace --move referenced a foreign anchor' >&2
  exit 1
fi
