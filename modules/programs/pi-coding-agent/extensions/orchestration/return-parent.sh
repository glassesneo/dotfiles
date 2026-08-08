#!/usr/bin/env bash
set -u

diagnostic_client=
fail() {
  local message=$1
  if [[ -n $diagnostic_client ]]; then
    tmux display-message -c "$diagnostic_client" "$message" 2>/dev/null || true
  else
    tmux display-message "$message" 2>/dev/null || true
  fi
  printf '%s\n' "$message" >&2
  exit 1
}

resolve_unique_client() {
  local agent_window clients line client session window
  local -a matches=()
  [[ -n ${TMUX_PANE:-} ]] || fail "/parent cannot identify its tmux pane"
  agent_window=$(tmux display-message -p -t "$TMUX_PANE" '#{window_id}' 2>&1) || fail "Could not identify the current mesh agent window: $agent_window"
  [[ -n $agent_window ]] || fail "Could not identify the current mesh agent window"
  clients=$(tmux list-clients -F '#{client_name}|#{session_id}|#{window_id}' 2>&1) || fail "Could not inspect tmux clients: $clients"
  while IFS= read -r line; do
    IFS='|' read -r client session window <<<"$line"
    if [[ -n $client && -n $session && $window == "$agent_window" ]]; then
      matches+=("$client|$session|$window")
    fi
  done <<<"$clients"
  ((${#matches[@]} == 1)) || fail "/parent requires exactly one client viewing this mesh agent window; found ${#matches[@]}"
  IFS='|' read -r expected_client expected_session expected_window <<<"${matches[0]}"
}

case $# in
0) resolve_unique_client ;;
4)
  [[ $1 == --binding ]] || fail "Invalid return-parent invocation"
  expected_client=$2
  expected_session=$3
  expected_window=$4
  ;;
*) fail "Invalid return-parent invocation" ;;
esac
for field in expected_client expected_session expected_window; do
  [[ -n ${!field} ]] || fail "Return-parent invocation context is incomplete"
done
diagnostic_client=$expected_client

format='#{pid}|#{session_id}|#{window_id}|#{client_name}|#{@pi_mesh_schema}|#{@pi_mesh_id}|#{@pi_mesh_epoch_id}|#{@pi_mesh_parent_server_pid}|#{@pi_mesh_parent_session_id}|#{@pi_mesh_parent_window_id}|#{@pi_mesh_hub_session_id}'
query=$(tmux display-message -p -c "$expected_client" "$format" 2>&1) || fail "Could not inspect the invoking tmux client: $query"
IFS='|' read -r server_pid viewing_session agent_window client_name schema mesh_id mesh_epoch_id parent_server parent_session parent_window hub_session <<<"$query"

[[ $client_name == "$expected_client" && $viewing_session == "$expected_session" && $agent_window == "$expected_window" ]] || fail "Tmux invocation context changed before parent return"
[[ $schema == 1 ]] || fail "No mesh parent for this window"
[[ -n $mesh_id && -n $mesh_epoch_id ]] || fail "Mesh identity metadata is incomplete"
for field in server_pid viewing_session agent_window client_name parent_server parent_session parent_window hub_session; do
  [[ -n ${!field} ]] || fail "Mesh parent metadata is incomplete"
done
[[ $server_pid == "$parent_server" ]] || fail "Mesh parent tmux server identity does not match"

tmux has-session -t "$parent_session" 2>/dev/null || fail "Mesh parent session no longer exists"
parent_found=$(tmux list-windows -t "$parent_session" -F '#{window_id}' 2>/dev/null) || fail "Could not inspect the mesh parent session"
grep -Fxq -- "$parent_window" <<<"$parent_found" || fail "Mesh parent window no longer exists"

tmux select-window -t "${parent_session}:${parent_window}" 2>/dev/null || fail "Could not select the mesh parent window"
tmux switch-client -c "$client_name" -t "$parent_session" 2>/dev/null || fail "Could not switch the tmux client to the mesh parent"

if [[ $viewing_session != "$hub_session" ]]; then
  if ! unlink_error=$(tmux unlink-window -t "${viewing_session}:${agent_window}" 2>&1); then
    message="Returned to parent, but the mesh agent view could not be unlinked${unlink_error:+: $unlink_error}"
    tmux display-message -c "$client_name" "$message" 2>/dev/null || true
    printf '%s\n' "$message" >&2
    exit 1
  fi
fi
