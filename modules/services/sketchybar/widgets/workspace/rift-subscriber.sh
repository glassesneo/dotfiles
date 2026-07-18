#!@runtime-shell@
set -u

rift_cli='@rift-cli@'
rift_exe='@rift-exe@'
sketchybar_exe='@sketchybar-exe@'

rift_pid() {
  /usr/bin/pgrep -f -x "$rift_exe" | /usr/bin/head -n 1
}

subscription_pid=""
cleanup() {
  if [ -n "$subscription_pid" ]; then
    kill "$subscription_pid" 2>/dev/null || true
    wait "$subscription_pid" 2>/dev/null || true
    subscription_pid=""
  fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM

while true; do
  server_pid="$(rift_pid)"
  if [ -z "$server_pid" ]; then
    sleep 1
    continue
  fi

  # A Mach subscription can remain blocked on the old port after Rift restarts.
  # Run it as a coprocess so the parent can replace it when the server PID changes.
  coproc RIFT_EVENTS { exec "$rift_cli" subscribe mach workspace_changed; }
  subscription_pid=$RIFT_EVENTS_PID
  event_fd=${RIFT_EVENTS[0]}

  while kill -0 "$subscription_pid" 2>/dev/null; do
    if IFS= read -r -t 1 -u "$event_fd" line && [ -n "$line" ]; then
      "$sketchybar_exe" --trigger workspace_change || true
    fi

    current_pid="$(rift_pid)"
    if [ "$current_pid" != "$server_pid" ]; then
      break
    fi
  done

  cleanup
  exec {event_fd}<&-
  sleep 1
done
