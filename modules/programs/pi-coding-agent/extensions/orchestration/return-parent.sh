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
  local child_window clients line client session window
  local -a matches=()
  [[ -n ${TMUX_PANE:-} ]] || fail "/parent cannot identify its tmux pane"
  child_window=$(tmux display-message -p -t "$TMUX_PANE" '#{window_id}' 2>&1) || fail "Could not identify the current subagent window: $child_window"
  [[ -n $child_window ]] || fail "Could not identify the current subagent window"
  clients=$(tmux list-clients -F '#{client_name}|#{session_id}|#{window_id}' 2>&1) || fail "Could not inspect tmux clients: $clients"
  while IFS= read -r line; do
    IFS='|' read -r client session window <<<"$line"
    if [[ -n $client && -n $session && $window == "$child_window" ]]; then
      matches+=("$client|$session|$window")
    fi
  done <<<"$clients"
  ((${#matches[@]} == 1)) || fail "/parent requires exactly one client viewing this subagent window; found ${#matches[@]}"
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

format='#{pid}|#{session_id}|#{window_id}|#{client_name}|#{@pi_subagent_schema}|#{@pi_subagent_parent_server_pid}|#{@pi_subagent_parent_session_id}|#{@pi_subagent_parent_window_id}|#{@pi_subagent_hub_session_id}'
query=$(tmux display-message -p -c "$expected_client" "$format" 2>&1) || fail "Could not inspect the invoking tmux client: $query"
IFS='|' read -r server_pid viewing_session child_window client_name schema parent_server parent_session parent_window hub_session <<<"$query"

[[ $client_name == "$expected_client" && $viewing_session == "$expected_session" && $child_window == "$expected_window" ]] || fail "Tmux invocation context changed before parent return"
[[ $schema == 1 ]] || fail "No subagent parent for this window"
for field in server_pid viewing_session child_window client_name parent_server parent_session parent_window hub_session; do
  [[ -n ${!field} ]] || fail "Subagent parent metadata is incomplete"
done
[[ $server_pid == "$parent_server" ]] || fail "Subagent parent tmux server identity does not match"

tmux has-session -t "$parent_session" 2>/dev/null || fail "Subagent parent session no longer exists"
parent_found=$(tmux list-windows -t "$parent_session" -F '#{window_id}' 2>/dev/null) || fail "Could not inspect the subagent parent session"
grep -Fxq -- "$parent_window" <<<"$parent_found" || fail "Subagent parent window no longer exists"

tmux select-window -t "${parent_session}:${parent_window}" 2>/dev/null || fail "Could not select the subagent parent window"
tmux switch-client -c "$client_name" -t "$parent_session" 2>/dev/null || fail "Could not switch the tmux client to the subagent parent"

if [[ $viewing_session != "$hub_session" ]]; then
  if ! unlink_error=$(tmux unlink-window -t "${viewing_session}:${child_window}" 2>&1); then
    message="Returned to parent, but the subagent view could not be unlinked${unlink_error:+: $unlink_error}"
    tmux display-message -c "$client_name" "$message" 2>/dev/null || true
    printf '%s\n' "$message" >&2
    exit 1
  fi
fi
