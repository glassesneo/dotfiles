#!/usr/bin/env bash
set -euo pipefail

media_dir=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT

runtime="$fixture/runtime"
bin="$fixture/bin"
cache_path="$fixture/cache/artwork.png"
hover_token_path="$fixture/state/hover-token"
log="$fixture/sketchybar.log"
handler="$runtime/widgets/media/handler.nu"
case_context=setup
mkdir -p "$runtime/widgets/media" "$bin" "$(dirname "$cache_path")"
cp "$media_dir/handler.nu" "$handler"
cp "$media_dir/../../colors.nu" "$runtime/colors.nu"

cat >"$bin/sketchybar" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$SKETCHYBAR_LOG"
EOF
chmod +x "$bin/sketchybar"

cat >"$bin/media-control" <<'EOF'
#!/usr/bin/env bash
if [[ ${1:-} == get ]]; then
  if [[ -n ${MEDIA_CONTROL_STATE:-} ]]; then
    printf '%s\n' "$MEDIA_CONTROL_STATE"
  else
    printf '%s\n' '{"playing":true,"title":"Forced Song","artist":"Forced Artist","album":"Forced Album"}'
  fi
fi
EOF
chmod +x "$bin/media-control"

sed -i \
  -e 's#@name@#media#g' \
  -e "s#@cache-path@#$cache_path#g" \
  -e "s#@hover-token-path@#$hover_token_path#g" \
  -e 's#@hover-delay@#200ms#g' \
  -e "s#@media-control@#$bin/media-control#g" \
  "$handler"

touch "$cache_path"

run_handler() (
  export SENDER=$1
  export SKETCHYBAR_LOG=$log
  export PATH="$bin:$PATH"
  if [[ -v PAYLOAD ]]; then export PAYLOAD; fi
  if [[ -v MEDIA_CONTROL_STATE ]]; then export MEDIA_CONTROL_STATE; fi
  nu --no-config-file "$handler"
)

reset_state() {
  rm -f "$log" "$hover_token_path" "$hover_token_path".*
}

fail() {
  echo "media hover test failed [$case_context]: $*" >&2
  exit 1
}

wait_for_hover_token() {
  local previous_token=${1:-}
  local current_token
  local attempt

  for attempt in {1..200}; do
    if [[ -s $hover_token_path ]]; then
      current_token=$(<"$hover_token_path")
      if [[ -z $previous_token || $current_token != "$previous_token" ]]; then
        printf '%s\n' "$current_token"
        return
      fi
    fi
    sleep 0.005
  done

  fail "hover token was not created or replaced within 1 second"
}

assert_label_replaced() {
  local previous_label=$1
  local transition=$2
  local effective_label_command
  effective_label_command=$(grep -F 'label=' "$log" | tail -n 1 || true)
  [[ -n $effective_label_command ]] || fail "$transition did not set an effective label"
  [[ $effective_label_command != *"label=$previous_label"* ]] || fail "$transition left the prior media label effective"
}

assert_no_popup_on() {
  if [[ -f $log ]] && grep -Fq 'popup.drawing=on' "$log"; then
    fail "popup was shown unexpectedly"
  fi
}

assert_popup_on_count() {
  local expected=$1
  local actual
  actual=$(grep -Fc 'popup.drawing=on' "$log" || true)
  [[ $actual == "$expected" ]] || fail "expected $expected popup show command(s), got $actual"
}

# A short hover must be cancelled by both exit event variants (AC1, AC4).
for exit_event in mouse.exited mouse.exited.global; do
  case_context="pending hover cancellation by $exit_event"
  reset_state
  run_handler mouse.entered &
  entered_pid=$!
  wait_for_hover_token >/dev/null
  run_handler "$exit_event"
  wait "$entered_pid"
  assert_no_popup_on
done

# Changing the active display invalidates a pending hover (AC7).
case_context="pending hover cancellation by display_change"
reset_state
run_handler mouse.entered &
entered_pid=$!
wait_for_hover_token >/dev/null
run_handler display_change
wait "$entered_pid"
assert_no_popup_on

# A sustained hover stays hidden during the delay, then shows (AC2).
case_context="sustained hover"
reset_state
run_handler mouse.entered &
entered_pid=$!
wait_for_hover_token >/dev/null
sleep 0.05
assert_no_popup_on
wait "$entered_pid"
assert_popup_on_count 1

# Exiting after the popup is visible closes it (AC3).
case_context="visible popup closed by mouse.exited"
run_handler mouse.exited
last_command=$(tail -n 1 "$log")
[[ $last_command == *'popup.drawing=off'* ]] || fail "exit did not close the popup"

# Changing the active display closes a visible popup instead of moving it (AC8).
case_context="visible popup closed by display_change"
reset_state
run_handler mouse.entered
assert_popup_on_count 1
run_handler display_change
last_command=$(tail -n 1 "$log")
[[ $last_command == *'popup.drawing=off'* ]] || fail "display change did not close the popup"

# Only the latest enter generation may show the popup (AC5).
case_context="latest hover generation"
reset_state
run_handler mouse.entered &
first_entered_pid=$!
first_token=$(wait_for_hover_token)
run_handler mouse.exited
run_handler mouse.entered &
second_entered_pid=$!
wait_for_hover_token "$first_token" >/dev/null
sleep 0.05
assert_no_popup_on
wait "$first_entered_pid"
wait "$second_entered_pid"
assert_popup_on_count 1

# Playback updates preserve label/artwork behavior without opening the popup (AC6).
case_context="playback update"
reset_state
PAYLOAD='{"title":"Test Song","artist":"Test Artist","album":"Test Album"}' run_handler media_stream_play
grep -Fq 'label=Test Song • Test Artist' "$log" || fail "play event did not update the label"
grep -Fq "popup.background.image=$cache_path" "$log" || fail "play event did not refresh artwork"
assert_no_popup_on

# Pause cancels an in-flight hover and clears the prior media state (AC6).
case_context="pause transition"
reset_state
pause_label='Pause Song • Pause Artist'
PAYLOAD='{"title":"Pause Song","artist":"Pause Artist","album":"Pause Album"}' run_handler media_stream_play
run_handler mouse.entered &
entered_pid=$!
wait_for_hover_token >/dev/null
run_handler media_stream_pause
wait "$entered_pid"
assert_no_popup_on
grep -Fq 'popup.background.image.drawing=off' "$log" || fail "pause did not disable artwork"
grep -Fq 'scroll_texts=off' "$log" || fail "pause did not hide the media label"
assert_label_replaced "$pause_label" "pause"

# Forced playing/stopped refresh paths remain unchanged (AC6).
case_context="forced playing transition"
reset_state
MEDIA_CONTROL_STATE='{"playing":true,"title":"Forced Song","artist":"Forced Artist","album":"Forced Album"}' run_handler forced
grep -Fq 'label=Forced Song • Forced Artist' "$log" || fail "forced playing state did not update the label"
assert_no_popup_on

case_context="forced stopped transition"
reset_state
forced_stopped_label='Before Stop • Previous Artist'
PAYLOAD='{"title":"Before Stop","artist":"Previous Artist","album":"Previous Album"}' run_handler media_stream_play
MEDIA_CONTROL_STATE='{"playing":false,"title":"","artist":"","album":""}' run_handler forced
grep -Fq 'popup.background.image.drawing=off' "$log" || fail "forced stopped state did not disable artwork"
grep -Fq 'scroll_texts=off' "$log" || fail "forced stopped state did not hide the media label"
assert_label_replaced "$forced_stopped_label" "forced stopped state"
