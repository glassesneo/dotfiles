use std/log
use ../state.nu
use ../providers/dock-badge.nu

const lsappinfo = "@lsappinfo@"
def apps [] { '@apps-json@' | from json }

def app_observation [bundle_id: string] {
  let running_result = (do { ^$lsappinfo find $"bundleID=($bundle_id)" } | complete)
  if $running_result.exit_code != 0 or ($running_result.stdout | str trim | is-empty) {
    return {running: false badge: null failed: ($running_result.exit_code != 0)}
  }
  let badge_result = (do { ^$lsappinfo info -only StatusLabel $"bundleID=($bundle_id)" } | complete)
  if $badge_result.exit_code != 0 {
    {running: true badge: null failed: true}
  } else {
    {running: true badge: (dock-badge status_label_from_output $badge_result.stdout) failed: false}
  }
}

def poll [app: record] {
  if not (state acquire $app.id) { return }
  let previous = (state read_provider $app.id)
  let observed = (app_observation $app.bundleId)
  let next = (dock-badge reduce $app.id $app.label $app.bundleId $app.icon $previous $observed.running $observed.badge $observed.failed (state now))
  let changed = $previous == null or $previous != $next
  try { state write_provider $app.id $next } catch {|err| log warning $"Could not save ($app.label) Dock state: ($err.msg)" }
  state release $app.id
  if $changed { state publish }
}

def main [] {
  for app in (apps) { poll $app }
}
