use ../providers/downloads.nu
use ../providers/dock-badge.nu

def assert [condition: bool, message: string] {
  if not $condition { error make {msg: $message} }
}

# Admission: reducer, latch, and stable-ID action data are repository-owned.
# A regression can duplicate a completion, erase app attention while unavailable,
# or copy/resolve a different file; Nix types and SketchyBar cannot observe this.
# Contract: given synthetic provider observations, when they cross normalized
# reducers, the popup consumer observes stable pending records and latch policy.
def main [] {
  let first = [{path: "/Downloads/existing.txt" size: 1 mtime: 1 regular: true}]
  let baseline = (downloads reduce null $first 100 2)
  assert (($baseline.items | length) == 0) "first scan must establish a non-notifying baseline"

  let temporary = ($first | append {path: "/Downloads/new.crdownload" size: 2 mtime: 2 regular: true})
  let after_temporary = (downloads reduce $baseline $temporary 101 2)
  assert (($after_temporary.items | length) == 0) "temporary suffixes must not become pending downloads"

  let renamed = ($first | append {path: "/Downloads/nested/final file.txt" size: 2 mtime: 2 regular: true})
  let candidate = (downloads reduce $after_temporary $renamed 102 2)
  let stable = (downloads reduce $candidate $renamed 104 2)
  assert (($stable.items | length) == 1) "stable renamed regular file must notify once"
  let repeated = (downloads reduce $stable $renamed 106 2)
  assert (($repeated.items | length) == 1) "repeated scans must not duplicate a completion"
  let overwritten_snapshot = ($first | append {path: "/Downloads/nested/final file.txt" size: 9 mtime: 9 regular: true})
  let overwrite_candidate = (downloads reduce $repeated $overwritten_snapshot 108 2)
  let overwritten = (downloads reduce $overwrite_candidate $overwritten_snapshot 110 2)
  assert (($overwritten.items | length) == 1 and $overwritten.items.0.fingerprint != $repeated.items.0.fingerprint) "overwriting a completed path must replace it with a new stable record"
  let deleted = (downloads reduce $overwritten $first 112 2)
  assert (($deleted.items | length) == 0) "deleted pending files must be removed"

  let multi = (downloads reduce $candidate ($renamed | append {path: "/Downloads/second.txt" size: 3 mtime: 3 regular: true}) 106 2)
  assert (($multi.items | length) == 1) "new candidates require their own stability interval"
  assert ((downloads zsh_quote "/Downloads/a b's.txt") == "'/Downloads/a b'\\''s.txt'") "clipboard paths must use POSIX single-quote encoding"

  let numeric = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" null true "12" false 1)
  assert ($numeric.observation == "attention" and $numeric.count == 12) "numeric Dock badges must retain their exact count"
  let marker = (dock-badge reduce "discord" "Discord" "com.example.discord" "D" null true "•" false 1)
  assert ($marker.observation == "attention" and $marker.count == 1 and $marker.badgeText == "•") "nonnumeric badges must remain visible markers"
  let unknown = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" $numeric false null false 2)
  assert ($unknown.observation == "unknown" and $unknown.count == 12 and ($unknown.items | length) == 1) "stopped applications must retain a prior latch without fabricating attention"
  let failed = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" $unknown true null true 3)
  assert ($failed.observation == "unknown" and $failed.count == 12) "failed observations must keep the unknown latch"
  let fresh_unknown = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" null false null false 3)
  assert ($fresh_unknown.observation == "unknown" and $fresh_unknown.count == null and ($fresh_unknown.items | length) == 0) "unknown without a latch must contribute no attention"
  let clear = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" $unknown true "" false 3)
  assert ($clear.observation == "clear" and $clear.count == 0) "only an observed running empty badge may clear a latch"
}
