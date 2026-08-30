use std/log
use ../state.nu
use ../providers/downloads.nu

const downloads_path = "@downloads-path@"
const find_exe = "@find@"
const fswatch = "@fswatch@"
const stability_seconds = @stability-seconds@
const retry_seconds = @retry-seconds@

def scan [] {
  if not ($downloads_path | path exists) { error make {msg: $"Downloads path is unavailable: ($downloads_path)"} }
  # A nonzero find is not an empty Downloads directory. Preserve the prior
  # provider state so permission/TCC failure cannot clear pending rows.
  let found = (do { ^$find_exe $downloads_path -type f -print } | complete)
  if $found.exit_code != 0 { error make {msg: $"Downloads scan failed (exit ($found.exit_code)): ($found.stderr | str trim)"} }
  $found.stdout
  | lines
  | each {|path|
      let statted = (do { ^/usr/bin/stat -f '%z %m' $path } | complete)
      if $statted.exit_code != 0 { error make {msg: $"Could not stat Downloads file ($path): ($statted.stderr | str trim)"} }
      let metadata = ($statted.stdout | str trim | split row " ")
      if ($metadata | length) != 2 { error make {msg: $"Invalid stat metadata for Downloads file: ($path)"} }
      {
        path: $path
        size: ($metadata.0 | into int)
        mtime: ($metadata.1 | into int)
        regular: true
        fingerprint: $"($path):($metadata.0):($metadata.1)"
      }
    }
}

def state_without_time [value: record] { $value | reject updatedAt }
def public_state [value: record] { $value | select source observation count badgeText summary items }

# Commit before publish. Scan, stat, lock, or write failure retains the prior
# atomic file and emits no event.
def reduce_scan [] {
  if not (state acquire "downloads") { return false }
  let result = try {
    let previous = (state read_provider "downloads")
    let next = (downloads reduce $previous (scan) (state now) $stability_seconds)
    let storage_changed = $previous == null or (state_without_time $previous) != (state_without_time $next)
    let attention_changed = $previous != null and (public_state $previous) != (public_state $next)
    if $storage_changed { state write_provider "downloads" $next }
    {ok: true publish: $attention_changed}
  } catch {|err|
    log warning $"Could not reduce or save Downloads observation: ($err.msg)"
    {ok: false publish: false}
  }
  state release "downloads"
  if $result.publish { state publish }
  $result.ok
}

export def process_event [] {
  # The follow-up scan sees all candidates created during the quiet window,
  # including paths not named by the one-per-batch fswatch marker.
  sleep 250ms
  reduce_scan | ignore
  sleep ($stability_seconds * 1sec)
  reduce_scan | ignore
}

def watch_once [] {
  # Nushell 0.114 discards an external stream's status after `for`. A tiny
  # argv-safe shell envelope preserves live event streaming and appends the
  # producer's real exit code as a sentinel for explicit backoff handling.
  const exit_prefix = "__notifications_fswatch_exit__"
  mut status = 0
  for line in (^/bin/sh -c '$1 -o -r --latency 0.2 "$2"; code=$?; printf "__notifications_fswatch_exit__%s\\n" "$code"' sh $fswatch $downloads_path | lines) {
    if ($line | str starts-with $exit_prefix) {
      $status = (try { $line | str replace $exit_prefix "" | into int } catch { 1 })
    } else {
      process_event
    }
  }
  $status
}

def backoff [reason: string] {
  log warning $"Downloads watcher ($reason); retrying in ($retry_seconds) seconds"
  sleep ($retry_seconds * 1sec)
}

def main [] {
  loop {
    if not ($downloads_path | path exists) {
      backoff $"path unavailable: ($downloads_path)"
      continue
    }
    # An inaccessible scan leaves any prior state untouched. Do not start a
    # watcher until a successful scan can establish or refresh the baseline.
    let scanned = (reduce_scan)
    if not $scanned {
      backoff "scan unavailable"
      continue
    }
    let status = (watch_once)
    backoff $"stream ended with exit ($status)"
  }
}
