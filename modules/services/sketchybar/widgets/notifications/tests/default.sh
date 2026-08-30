#!/usr/bin/env bash
set -euo pipefail

# Admission: providers, persisted state, action routing, and popup generations
# are repository-owned behavior. Broken state can copy/resolve the wrong file,
# repeat attention forever, or discard independent updates; Nix evaluation and
# SketchyBar do not observe those outcomes.
# Contract: given synthetic filesystem, Dock, clipboard, app, and SketchyBar
# boundaries, the widget consumer observes stable resolution, latching, popup
# state, one-shot generations, and atomic valid persistence.

notifications_dir=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
runtime="$fixture/runtime"
bin="$fixture/bin"
state="$fixture/state"
downloads="$fixture/Downloads"
log="$fixture/sketchybar.log"
clipboard="$fixture/clipboard"
open_log="$fixture/open.log"
fswatch_log="$fixture/fswatch.log"
mkdir -p "$runtime/widgets" "$bin" "$state" "$downloads"
cp -R "$notifications_dir" "$runtime/widgets/notifications"
cp "$notifications_dir/../../colors.nu" "$runtime/colors.nu"

cat >"$bin/sketchybar" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$SKETCHYBAR_LOG"
EOF
cat >"$bin/pbcopy" <<'EOF'
#!/usr/bin/env bash
if [[ ${PBCOPY_FAIL:-0} == 1 ]]; then exit 1; fi
tee "$PBCOPY_OUT" >/dev/null
EOF
cat >"$bin/open" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$OPEN_LOG"
EOF
cat >"$bin/lsappinfo" <<'EOF'
#!/usr/bin/env bash
case ${1:-} in
  find) printf 'pid = 42\n' ;;
  info) printf 'StatusLabel = "%s"\n' "${MOCK_BADGE:-7}" ;;
esac
EOF
cat >"$bin/find" <<'EOF'
#!/usr/bin/env bash
if [[ ${FIND_FAIL:-0} == 1 ]]; then
  printf 'permission denied\n' >&2
  exit 1
fi
exec /usr/bin/find "$@"
EOF
cat >"$bin/fswatch" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FSWATCH_LOG"
if [[ ${FSWATCH_FAIL:-0} == 1 ]]; then
  printf 'watch failed\n' >&2
  exit 1
fi
path=
for argument in "$@"; do path=$argument; done
sleep 0.1
printf 'new download\n' >"$path/from-fswatch.txt"
printf 'second download\n' >"$path/from-fswatch-second.txt"
printf '%s\n' "$path/from-fswatch.txt"
printf '%s\n' "$path/from-fswatch-second.txt"
EOF
chmod +x "$bin"/*

find "$runtime/widgets/notifications" -type f -name '*.nu' -exec sed -i'' \
  -e "s|@state-dir@|$state|g" \
  -e "s|@downloads-path@|$downloads|g" \
  -e "s|@find@|$bin/find|g" \
  -e 's|@stability-seconds@|1|g' \
  -e 's|@retry-seconds@|1|g' \
  -e 's|@visible-limit@|3|g' \
  -e "s|@sketchybar-exe@|$bin/sketchybar|g" \
  -e "s|@pbcopy@|$bin/pbcopy|g" \
  -e "s|@open@|$bin/open|g" \
  -e "s|@lsappinfo@|$bin/lsappinfo|g" \
  -e "s|@fswatch@|$bin/fswatch|g" \
  -e 's|@apps-json@|[{"id":"slack","label":"Slack","bundleId":"com.example.slack","icon":"S"}]|g' \
  -e 's|@enabled-sources-json@|["downloads","slack"]|g' \
  -e 's|__script_path__|/bin/true|g' {} +

fail() {
  echo "notifications test failed: $*" >&2
  exit 1
}
run_handler() (
  export PATH="$bin:$PATH" SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  export SENDER=${SENDER:-}
  nu --no-config-file "$runtime/widgets/notifications/handler.nu" "$@"
)
run_social() (
  export PATH="$bin:$PATH" SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file "$runtime/widgets/notifications/services/social.nu"
)
write_downloads() {
  local items=$1
  printf '%s' "{\"schemaVersion\":1,\"source\":\"downloads\",\"observation\":\"attention\",\"count\":2,\"badgeText\":null,\"summary\":\"2 completed downloads\",\"items\":$items,\"scanIndex\":[],\"initialized\":true,\"updatedAt\":1}" >"$state/downloads.json"
}
download_item() {
  local id=$1 path=$2 detected=$3
  printf '{"id":"%s","path":"%s","fingerprint":"%s","label":"%s","detail":"/Downloads","action":"copy-download","detectedAt":%s}' "$id" "$path" "$id-fingerprint" "$(basename "$path")" "$detected"
}
write_slack() {
  printf '%s' '{"schemaVersion":1,"source":"slack","observation":"attention","count":7,"badgeText":"7","summary":"Slack 7","items":[{"id":"slack","label":"Slack","detail":"7","action":"activate-app","bundleId":"com.example.slack","icon":"S"}],"updatedAt":1}' >"$state/slack.json"
}
write_slack_unknown() {
  local count=$1
  printf '%s' "{\"schemaVersion\":1,\"source\":\"slack\",\"observation\":\"unknown\",\"count\":$count,\"badgeText\":\"$count\",\"summary\":\"Slack badge unavailable; retaining prior attention\",\"items\":[{\"id\":\"slack\",\"label\":\"Slack\",\"detail\":\"$count\",\"action\":\"activate-app\",\"bundleId\":\"com.example.slack\",\"icon\":\"S\"}],\"updatedAt\":1}" >"$state/slack.json"
}

# Reducer contracts remain the narrow boundary for baseline/temporary/restart
# normalization. The shell cases below cover process and command boundaries.
(cd "$runtime/widgets/notifications/tests" && nu --no-config-file default.nu)

printf x >"$downloads/a file's.txt"
printf y >"$downloads/b.txt"
item_a=$(download_item a "$downloads/a file's.txt" 1)
item_b=$(download_item b "$downloads/b.txt" 2)
write_downloads "[$item_a,$item_b]"
write_slack

# AC3: a legacy schema-v1 pending row migrates in place; successful copy keeps
# its stable history ID, clears only its attention, and remains re-copyable.
run_handler copy-download b
[[ $(<"$clipboard") == "'$downloads/b.txt'" ]] || fail "clipboard bytes were not a zsh-ready selected path"
grep -q '"id":"a".*"status":"pending"' "$state/downloads.json" || fail "selected row resolved a different stable ID"
grep -q '"id":"b".*"status":"resolved"' "$state/downloads.json" || fail "clipboard success did not retain a resolved history row"
grep -q '"count":1' "$state/downloads.json" || fail "successful copy did not clear only selected attention"
grep -q 'label=\[Pending\]' "$log" || fail "pending Download row lacked a semantic state label"
grep -q 'label=\[Copied — re-copy\]' "$log" || fail "resolved Download row lacked a semantic state label"
run_handler copy-download b
[[ $(<"$clipboard") == "'$downloads/b.txt'" ]] || fail "resolved history row was not re-copyable"
grep -q '"id":"b".*"status":"resolved"' "$state/downloads.json" || fail "re-copy changed resolved history state"

# Clipboard failure retains the pending row and its attention.
write_downloads "[$item_a,$item_b]"
PBCOPY_FAIL=1 run_handler copy-download a
[[ -f "$state/downloads.json" ]] || fail "clipboard failure removed state"
grep -q '"id":"a".*"status":"pending"' "$state/downloads.json" || fail "clipboard failure resolved a record"
grep -q '"count":2' "$state/downloads.json" || fail "clipboard failure cleared attention"

# Missing files remain as unavailable history while other pending attention is
# preserved. A symlink substituted after scan is also never sent to pbcopy.
rm "$downloads/b.txt"
run_handler copy-download b
grep -q '"id":"b".*"status":"unavailable"' "$state/downloads.json" || fail "missing row was not retained as unavailable"
grep -q '"observation":"attention"' "$state/downloads.json" || fail "stale resolution cleared remaining attention"
grep -q '"count":1' "$state/downloads.json" || fail "stale resolution did not update count"
grep -q 'label=\[Unavailable\]' "$log" || fail "unavailable Download row lacked a semantic state label"
printf target >"$downloads/target.txt"
ln -s "$downloads/target.txt" "$downloads/replaced-link.txt"
link_item=$(download_item link "$downloads/replaced-link.txt" 3)
write_downloads "[$link_item]"
clipboard_before=${clipboard:+$(cksum "$clipboard")}
run_handler copy-download link
[[ ! -e $clipboard || $(cksum "$clipboard") == "$clipboard_before" ]] || fail "symlink replacement reached pbcopy"
grep -q '"id":"link".*"status":"unavailable"' "$state/downloads.json" || fail "symlink row was not retained as unavailable"
# An already-unavailable row flashes but must not retry the clipboard.
clipboard_before=$(cksum "$clipboard")
: >"$log"
run_handler copy-download link
[[ $(cksum "$clipboard") == "$clipboard_before" ]] || fail "unavailable history row retried pbcopy"
grep -q 'background.border_color' "$log" || fail "unavailable history row did not flash an error"
grep -q '"status":"unavailable"' "$state"/downloads.json || fail "unavailable history row did not remain visible"

# AC6: only the Nix-authored allowlisted bundle is opened and no state is cleared.
slack_before=$(cksum "$state/slack.json")
run_handler activate-app slack
grep -Fxq -- '-b com.example.slack' "$open_log" || fail "social action did not use the allowlisted bundle"
[[ $(cksum "$state/slack.json") == "$slack_before" ]] || fail "social activation cleared attention"

# Repeated identical Dock observations do not publish repeatedly.
: >"$log"
run_social
run_social
after_identical=$(grep -c 'trigger notifications_changed' "$log" || true)
[[ $after_identical == 0 ]] || fail "unchanged social poll published attention"
MOCK_BADGE=9 run_social
[[ $(grep -c 'trigger notifications_changed' "$log" || true) == 1 ]] || fail "changed social badge did not publish exactly once"

# Idle Downloads history is popup content even when its aggregate attention is
# zero: hover and pin must open it without inventing a main-item count.
write_downloads "[$item_a]"
run_handler copy-download a
[[ $(grep -o '"count":[0-9]*' "$state/downloads.json" | head -1) == '"count":0' ]] || fail "resolved idle history retained attention"
: >"$log"
SENDER=mouse.entered run_handler
sleep 0.6
grep -q 'popup.drawing=on' "$log" || fail "idle Downloads history did not open on hover"
run_handler click-main
[[ $(grep -o '"pinned":[^,]*' "$state/popup.json") == '"pinned":true' ]] || fail "idle Downloads history did not pin"
run_handler click-main

# AC2/AC7: forced render resets and closes; a subsequent transition animates
# once, while an unchanged event cannot replay it. Pinning is a single route.
: >"$log"
SENDER=forced run_handler
popup=$(<"$state/popup.json")
[[ $popup == *'"pinned":false'* && $popup == *'"mainHovered":false'* && $popup == *'"popupHovered":false'* ]] || fail "forced render did not reset popup interaction"
grep -q 'popup.drawing=off' "$log" || fail "forced render did not close popup"
MOCK_BADGE=10 run_social
SENDER=notifications_changed run_handler
first_animation=$(grep -c -- '--animate' "$log" || true)
grep -q 'icon=S' "$log" || fail "Slack increase did not select its source icon while Downloads was pending"
# The consumer-visible command sequence fades the old glyph before a source
# swap, uses restrained offsets, and finishes at the shared bell glyph.
grep -q 'icon.y_offset=-4 icon.alpha=0' "$log" || fail "attention animation did not fade the prior glyph before swapping"
grep -q 'icon=S icon.y_offset=4 icon.alpha=0' "$log" || fail "attention animation did not stage the source glyph after fade-out"
grep -q 'icon= icon.y_offset=3 icon.alpha=0' "$log" || fail "attention animation did not settle through the common pending glyph"
[[ $first_animation -ge 4 ]] || fail "attention animation did not complete its semantic phases"
SENDER=notifications_changed run_handler
[[ $(grep -c -- '--animate' "$log" || true) == "$first_animation" ]] || fail "unchanged attention replayed animation"
write_slack_unknown 10
SENDER=notifications_changed run_handler
[[ $(grep -c -- '--animate' "$log" || true) == "$first_animation" ]] || fail "same-count unknown latch replayed animation"
# A newer source projection cancels the earlier animation before its glyph swap;
# only the newest generation may stage a source glyph.
: >"$log"
MOCK_BADGE=11 run_social
SENDER=notifications_changed run_handler &
stale_animation=$!
sleep 0.05
MOCK_BADGE=12 run_social
SENDER=notifications_changed run_handler &
fresh_animation=$!
wait "$stale_animation"
wait "$fresh_animation"
[[ $(grep -c 'icon=S icon.y_offset=4 icon.alpha=0' "$log" || true) == 1 ]] || fail "superseded animation staged a stale source glyph"
# A main→popup move cancels the delayed close; leaving the popup closes later.
: >"$log"
SENDER=mouse.entered run_handler &
main_enter=$!
sleep 0.05
SENDER=mouse.exited run_handler &
main_exit=$!
sleep 0.05
SENDER=mouse.entered run_handler popup-event
wait "$main_enter"
wait "$main_exit"
sleep 0.25
grep -q 'popup.drawing=on' "$log" || fail "popup did not remain traversable from the main item"
! grep -q 'popup.drawing=off' "$log" || fail "delayed main close won after popup entry"
SENDER=mouse.exited run_handler popup-event
grep -q 'popup.drawing=off' "$log" || fail "popup exit did not schedule delayed close"
run_handler click-main
[[ $(grep -o '"pinned":[^,]*' "$state/popup.json") == '"pinned":true' ]] || fail "main click did not pin exactly once"
SENDER=mouse.exited.global run_handler
popup=$(<"$state/popup.json")
[[ $popup == *'"mainHovered":false'* && $popup == *'"popupHovered":false'* && $popup == *'"pinned":true'* ]] || fail "global exit did not clear both hover flags while preserving pin"
run_handler click-main
grep -q 'popup.drawing=off' "$log" || fail "unpin did not close an unhovered popup"

# AC8: competing stable-ID actions preserve unrelated Slack state and publish
# well-formed JSON; malformed state is moved aside instead of being retried.
printf z >"$downloads/b.txt"
write_downloads "[$item_a,$item_b]"
run_handler copy-download a &
pid_a=$!
run_handler copy-download b &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
[[ $(grep -o '"count":[0-9]*' "$state/downloads.json" | head -1) == '"count":0' ]] || fail "concurrent actions lost a download resolution"
grep -q '"source":"slack"' "$state/slack.json" || fail "concurrent Download actions lost unrelated provider state"
printf '%s' '{"schemaVersion":1,"source":"downloads","items":"bad"}' >"$state/downloads.json"
SENDER=notifications_changed run_handler
find "$state" -name 'downloads.json.corrupt-*' -print -quit | grep -q . || fail "malformed provider state was not quarantined"
rm -f "$state"/downloads.json.corrupt-*
# Fields consumed by rendering are schema fields too, not merely optional text.
printf '%s' '{"schemaVersion":1,"source":"downloads","observation":"attention","count":1,"badgeText":null,"summary":"bad","items":[{"id":"bad","path":"/tmp/bad","fingerprint":"bad","label":"bad","detail":1,"action":"copy-download","detectedAt":1}],"scanIndex":[],"initialized":true,"updatedAt":1}' >"$state/downloads.json"
SENDER=notifications_changed run_handler
find "$state" -name 'downloads.json.corrupt-*' -print -quit | grep -q . || fail "malformed download detail was not quarantined"
printf '%s' '{"schemaVersion":1,"source":"slack","observation":"attention","count":1,"badgeText":"1","summary":"bad","items":[{"id":"slack","label":"Slack","detail":"1","action":"activate-app","bundleId":"com.example.slack","icon":1}],"updatedAt":1}' >"$state/slack.json"
SENDER=notifications_changed run_handler
find "$state" -name 'slack.json.corrupt-*' -print -quit | grep -q . || fail "malformed social icon was not quarantined"

# AC4: a mocked fswatch event is followed by the stability rescan even when no
# second event arrives, producing a completion record.
rm -f "$state/downloads.json" "$downloads"/*
# The service must request one marker per batch from its fswatch consumer.
(
  export PATH="$bin:$PATH" FSWATCH_LOG="$fswatch_log" SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file "$runtime/widgets/notifications/services/downloads.nu"
) &
watcher=$!
sleep 1
kill "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
# The test deliberately terminates a service that may be inside its lock.
rm -rf "$state/downloads.lock"
grep -q -- '-o -r' "$fswatch_log" || fail "Downloads watcher did not request one fswatch marker per batch"
rm -f "$state/downloads.json" "$downloads"/*
# Establish the non-notifying baseline before the injected event.
(
  export PATH="$bin:$PATH" SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file -c "use $runtime/widgets/notifications/services/downloads.nu; downloads process_event"
)
# Injected fswatch creates one event and exits; process_event then performs the
# delayed scan explicitly, proving that no second watcher event is required.
FSWATCH_LOG="$fswatch_log" "$bin/fswatch" -o -r --latency 0.2 "$downloads" >/dev/null
(
  export PATH="$bin:$PATH" SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file -c "use $runtime/widgets/notifications/services/downloads.nu; downloads process_event"
)
grep -q 'from-fswatch.txt' "$state/downloads.json" || fail "first fswatch batch file lacked a delayed stability rescan"
grep -q 'from-fswatch-second.txt' "$state/downloads.json" || fail "second fswatch batch file was omitted from the follow-up scan"

# A failing scan is unavailable data, never an empty snapshot: prior pending
# state and the rendered event stream remain intact.
write_downloads "[$item_a]"
: >"$log"
(
  export PATH="$bin:$PATH" FIND_FAIL=1 SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file -c "use $runtime/widgets/notifications/services/downloads.nu; downloads process_event"
) || true
grep -q '"id":"a"' "$state/downloads.json" || fail "failed scan cleared prior Downloads state"
! grep -q 'trigger notifications_changed' "$log" || fail "failed scan published a clear transition"
rm -rf "$state/downloads.lock"

# A terminating watcher backs off before launchd can observe a tight loop. The
# test substitution uses one second, so sub-second observation must see one run.
: >"$fswatch_log"
(
  export PATH="$bin:$PATH" FSWATCH_LOG="$fswatch_log" FSWATCH_FAIL=1 SKETCHYBAR_LOG="$log" PBCOPY_OUT="$clipboard" OPEN_LOG="$open_log"
  nu --no-config-file "$runtime/widgets/notifications/services/downloads.nu"
) &
failing_watcher=$!
sleep 0.4
[[ $(wc -l <"$fswatch_log") == 1 ]] || fail "failed fswatch restarted without backoff"
kill "$failing_watcher" 2>/dev/null || true
wait "$failing_watcher" 2>/dev/null || true
rm -rf "$state/downloads.lock"

# A contended source lock falls back to its atomic validated snapshot rather
# than committing an aggregate that silently drops that provider.
write_downloads "[$item_a,$item_b]"
mkdir "$state/downloads.lock"
SENDER=notifications_changed run_handler
rmdir "$state/downloads.lock"
grep -q '"source":"downloads"' "$state/popup.json" || fail "lock contention dropped the existing Downloads projection"
grep -q '"count":2' "$state/popup.json" || fail "lock contention reduced the existing Downloads count"
