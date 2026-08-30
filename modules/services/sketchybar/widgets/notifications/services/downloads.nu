use std/log
use ../state.nu
use ../providers/downloads.nu

const downloads_path = "@downloads-path@"
const fswatch = "@fswatch@"
const stability_seconds = @stability-seconds@

def scan [] {
  if not ($downloads_path | path exists) { error make {msg: $"Downloads path is unavailable: ($downloads_path)"} }
  ^/usr/bin/find -P $downloads_path -type f -print
  | lines
  | each {|path|
      let metadata = try { ^/usr/bin/stat -f '%z\t%m' $path | str trim | split row "\t" } catch { [] }
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

def reduce_scan [] {
  if not (state acquire "downloads") { return }
  let previous = (state read_provider "downloads")
  let next = try { downloads reduce $previous (scan) (state now) $stability_seconds } catch {|err|
    state release "downloads"
    log warning $"Could not reduce Downloads observation: ($err.msg)"
    return
  }
  let changed = $previous == null or $previous != $next
  try { state write_provider "downloads" $next } catch {|err| log warning $"Could not save Downloads state: ($err.msg)" }
  state release "downloads"
  if $changed { state publish }
}

def main [] {
  # The wrapper owns missing-path recovery. It does not exit and make launchd
  # restart continuously when TCC or a temporarily absent Downloads directory blocks access.
  loop {
    if not ($downloads_path | path exists) {
      log warning $"Downloads path unavailable; retrying in 60 seconds: ($downloads_path)"
      sleep 60sec
      continue
    }
    reduce_scan
    try {
      for _event in (^$fswatch -r $downloads_path | lines) {
        sleep 200ms
        reduce_scan
      }
    } catch {|err|
      log warning $"Downloads watcher failed; retrying in 60 seconds: ($err.msg)"
      sleep 60sec
    }
  }
}
