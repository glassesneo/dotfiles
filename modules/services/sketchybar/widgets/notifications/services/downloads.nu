use std/log
use ../state.nu
use ../providers/downloads.nu

const downloads_path = "@downloads-path@"
const fswatch = "@fswatch@"
const stability_seconds = @stability-seconds@

def scan [] {
  if not ($downloads_path | path exists) { error make {msg: $"Downloads path is unavailable: ($downloads_path)"} }
  # BSD find does not follow symlinked directories unless explicitly given -L.
  ^/usr/bin/find $downloads_path -type f -print
  | lines
  | each {|path|
      let metadata = try { ^/usr/bin/stat -f '%z %m' $path | str trim | split row " " } catch { [] }
      if ($metadata | length) != 2 { null } else {
        {
          path: $path
          size: ($metadata.0 | into int)
          mtime: ($metadata.1 | into int)
          regular: true
          fingerprint: $"($path):($metadata.0):($metadata.1)"
        }
      }
    }
  | compact
}

def state_without_time [value: record] { $value | reject updatedAt }
def public_state [value: record] { $value | select source observation count badgeText summary items }

# Commit before publish. A failed write leaves the prior file and emits no event.
def reduce_scan [] {
  if not (state acquire "downloads") { return }
  let published = try {
    let previous = (state read_provider "downloads")
    let next = (downloads reduce $previous (scan) (state now) $stability_seconds)
    let storage_changed = $previous == null or (state_without_time $previous) != (state_without_time $next)
    let attention_changed = $previous != null and (public_state $previous) != (public_state $next)
    if $storage_changed { state write_provider "downloads" $next }
    $attention_changed
  } catch {|err|
    log warning $"Could not reduce or save Downloads observation: ($err.msg)"
    false
  }
  state release "downloads"
  if $published { state publish }
}

export def process_event [] {
  stable_rescan
}

def stable_rescan [] {
  # fswatch reports a change, not completion. The first scan coalesces a burst;
  # the second is guaranteed after the stability window even when no later event arrives.
  sleep 250ms
  reduce_scan
  sleep ($stability_seconds * 1sec)
  reduce_scan
}

def main [] {
  loop {
    if not ($downloads_path | path exists) {
      log warning $"Downloads path unavailable; retrying in 60 seconds: ($downloads_path)"
      sleep 60sec
      continue
    }
    reduce_scan
    try {
      # fswatch latency batches event bursts. Each emitted batch receives the
      # guaranteed delayed rescan above, so a quiet writer can still complete.
      for _event in (^$fswatch -r --latency 0.2 $downloads_path | lines) { process_event }
    } catch {|err|
      log warning $"Downloads watcher failed; retrying in 60 seconds: ($err.msg)"
      sleep 60sec
    }
  }
}
