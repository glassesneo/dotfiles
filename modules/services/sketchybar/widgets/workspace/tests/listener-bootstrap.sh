#!/usr/bin/env bash
set -euo pipefail

# Admission: the repository owns SketchyBar recovery when Rift is unavailable
# during initial rendering; without a durable event receiver, later native Rift
# events cannot restore the workspace widget, and Nix evaluation cannot observe
# runtime command ordering. Given an unavailable Rift provider during render,
# SketchyBar still observes a subscribed workspace listener while no workspace
# items are fabricated from absent state.
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/config/widgets/workspace/providers" "$test_root/state"
export COMMANDS_FILE="$test_root/sketchybar-commands"
export RIFT_ATTEMPTS_FILE="$test_root/rift-attempts"

cat >"$test_root/bin/sketchybar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '<%s>' "$@" >>"$COMMANDS_FILE"
printf '\n' >>"$COMMANDS_FILE"
EOF

cat >"$test_root/bin/rift-cli" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'attempt\n' >>"$RIFT_ATTEMPTS_FILE"
exit 1
EOF
chmod +x "$test_root/bin/sketchybar" "$test_root/bin/rift-cli"

cat >"$test_root/config/colors.nu" <<'EOF'
export const text_primary = "0xffffffff"
export const workspace_active = "0xffffffff"
EOF

cp ../providers/aerospace.nu "$test_root/config/widgets/workspace/providers/aerospace.nu"
cp ../providers/rift.nu "$test_root/config/widgets/workspace/providers/rift.nu"
sed \
  -e 's|@backend@|rift|g' \
  -e "s|@aerospace-exe@|$test_root/bin/aerospace|g" \
  -e "s|@rift-cli@|$test_root/bin/rift-cli|g" \
  -e "s|__script_path__|$test_root/config/widgets/workspace/script|g" \
  ../handler.nu >"$test_root/config/widgets/workspace/handler.nu"

HOME="$test_root" \
  XDG_STATE_HOME="$test_root/state" \
  PATH="$test_root/bin:$PATH" \
  nu "$test_root/config/widgets/workspace/handler.nu" render left

[[ -s $RIFT_ATTEMPTS_FILE ]]
grep -Fq '<--add><event><workspace_change>' "$COMMANDS_FILE"
grep -Fq '<--add><item><workspaces-listener><left>' "$COMMANDS_FILE"
grep -Fq '<--subscribe><workspaces-listener><display_change><space_change><workspace_change>' "$COMMANDS_FILE"
if grep -Fq '<--add><item><workspace.rift.' "$COMMANDS_FILE"; then
  echo 'workspace items must not be fabricated while Rift state is unavailable' >&2
  exit 1
fi
