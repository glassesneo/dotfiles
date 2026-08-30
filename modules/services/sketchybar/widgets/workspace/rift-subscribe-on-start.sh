if [ "$#" -ne 2 ]; then
  echo "usage: $0 RIFT_CLI EVENT_BRIDGE" >&2
  exit 64
fi

rift_cli=$1
event_bridge=$2
origin_rift_pid=$PPID

originating_rift_is_alive() {
  /bin/kill -0 "$origin_rift_pid" 2>/dev/null
}

while originating_rift_is_alive; do
  if "$rift_cli" subscribe cli --event workspace_changed --command /bin/bash --args "$event_bridge"; then
    # Reconcile SketchyBar after every Rift generation, including crash
    # recovery that rebuilt Rift's virtual workspace state.
    /bin/bash "$event_bridge"
    exit 0
  fi
  /bin/sleep 0.1
done

# Best-effort fence: stop retrying after the originating Rift exits. If death
# overlaps an in-flight CLI attempt, the stable callback identity deduplicates it.
exit 0
