#!/usr/bin/env bash
set -euo pipefail

# Admission: the repository owns startup registration across Rift's IPC-readiness
# race; Nix evaluation cannot prove retry/termination behavior. Given initial CLI
# connection failures followed by readiness, Rift gets one successful native
# subscription with a generation-stable command identity and the startup helper
# exits without another attempt.
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

export ATTEMPT_FILE="$test_root/attempts"
export SUCCESS_FILE="$test_root/successes"
export ARGS_FILE="$test_root/args"

cat >"$test_root/fake-rift-cli" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

attempts=0
if [[ -f "$ATTEMPT_FILE" ]]; then
  attempts=$(<"$ATTEMPT_FILE")
fi
attempts=$((attempts + 1))
printf '%s\n' "$attempts" >"$ATTEMPT_FILE"
printf '%s\n' "$*" >>"$ARGS_FILE"

if ((attempts < 3)); then
  exit 1
fi
printf 'registered\n' >>"$SUCCESS_FILE"
EOF
chmod +x "$test_root/fake-rift-cli"

bash ../rift-subscribe-on-start.sh "$test_root/fake-rift-cli" "$test_root/event-bridge"

[[ $(<"$ATTEMPT_FILE") == 3 ]]
[[ $(wc -l <"$SUCCESS_FILE" | tr -d '[:space:]') == 1 ]]
[[ $(wc -l <"$ARGS_FILE" | tr -d '[:space:]') == 3 ]]
while IFS= read -r args; do
  [[ $args == "subscribe cli --event workspace_changed --command /bin/bash --args $test_root/event-bridge" ]]
done <"$ARGS_FILE"
