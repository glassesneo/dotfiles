use ../providers/downloads.nu
use ../providers/dock-badge.nu

def assert [condition: bool, message: string] {
  if not $condition { error make {msg: $message} }
}

def item [state: record, name: string] { $state.items | where label == $name | first }

# Admission: the Downloads reducer owns a persistent history/attention protocol
# which Nix and SketchyBar cannot validate. Losing, duplicating, or re-alerting a
# completion misleads the popup consumer after a scan or restart.
# Contract: given normalized filesystem scans and persisted Downloads state, when
# the reducer publishes the provider record, the popup consumer observes a
# last-three history, attention only for pending available records, and a durable
# seen fingerprint.
def main [] {
  let existing = {path: "/Downloads/existing.txt" size: 9 mtime: 9 regular: true}
  let baseline = (downloads reduce null [$existing] 100 2)
  assert ($baseline.items == [] and $baseline.scanIndex.0.notified) "baseline files must be recorded as already seen"
  let a = {path: "/Downloads/a.txt" size: 1 mtime: 1 regular: true}
  let a_candidate = (downloads reduce $baseline [$a] 101 2)
  let a_done = (downloads reduce $a_candidate [$a] 103 2)
  assert (($a_done.items | length) == 1 and (item $a_done "a.txt").status == "pending") "a stable completion must enter pending history"

  let b = {path: "/Downloads/b.txt" size: 2 mtime: 2 regular: true}
  let b_candidate = (downloads reduce $a_done [$a $b] 104 2)
  let b_done = (downloads reduce $b_candidate [$a $b] 106 2)
  let c = {path: "/Downloads/c.txt" size: 3 mtime: 3 regular: true}
  let c_candidate = (downloads reduce $b_done [$a $b $c] 107 2)
  let c_done = (downloads reduce $c_candidate [$a $b $c] 109 2)
  let d = {path: "/Downloads/d.txt" size: 4 mtime: 4 regular: true}
  let d_candidate = (downloads reduce $c_done [$a $b $c $d] 110 2)
  let d_done = (downloads reduce $d_candidate [$a $b $c $d] 112 2)
  assert (($d_done.items | length) == 3) "a fourth completion must retain exactly three history rows"
  assert (($d_done.items | get label) == ["d.txt" "c.txt" "b.txt"]) "a fourth completion must evict the oldest record even when it is pending"
  assert ($d_done.count == 3 and $d_done.attentionVersion == ($c_done.attentionVersion + 1)) "a capped unchanged count must still signal a new completion"

  let missing = (downloads reduce $d_done [$a $b $d] 114 2)
  assert ((item $missing "c.txt").status == "unavailable" and $missing.count == 2 and $missing.attentionVersion == $d_done.attentionVersion) "deletion must resolve attention without creating a completion signal"

  let resolved = ($a_done | upsert items [($a_done.items.0 | upsert status "resolved")] | upsert count 0 | upsert observation "clear")
  let restarted = (downloads reduce $resolved [$a] 120 2)
  assert (($restarted.items | length) == 1 and $restarted.items.0.status == "resolved" and $restarted.count == 0) "a resolved row must remain history without re-notification after restart"
  assert ($restarted.scanIndex.0.notified) "a resolved fingerprint must remain seen in the scan index"

  let legacy = {
    schemaVersion: 1 source: "downloads" observation: "attention" count: 1 badgeText: null summary: "old"
    items: [{id: "legacy" path: "/Downloads/legacy.txt" fingerprint: "legacy-fingerprint" label: "legacy.txt" detail: "/Downloads" action: "copy-download" detectedAt: 1}]
    scanIndex: [
      {path: "/Downloads/legacy.txt" fingerprint: "legacy-fingerprint" size: 1 mtime: 1 stableSince: 1 baseline: false}
      {path: "/Downloads/trimmed.txt" fingerprint: "trimmed-fingerprint" size: 2 mtime: 2 stableSince: 1 baseline: false}
    ]
    initialized: true updatedAt: 1
  }
  let migrated = (downloads normalize_state $legacy)
  assert ($migrated.items.0.id == "legacy" and $migrated.items.0.status == "pending" and $migrated.count == 1) "legacy pending rows must migrate without loss"
  assert (($migrated.scanIndex | all {|entry| $entry.notified }) and $migrated.attentionVersion == 0) "legacy indexes without notified fields must all migrate seen without fabricating a signal"
  let after_legacy_restart = (downloads reduce $migrated [
    {path: "/Downloads/legacy.txt" size: 1 mtime: 1 regular: true fingerprint: "legacy-fingerprint"}
    {path: "/Downloads/trimmed.txt" size: 2 mtime: 2 regular: true fingerprint: "trimmed-fingerprint"}
  ] 100 2)
  assert (($after_legacy_restart.items | length) == 1 and $after_legacy_restart.attentionVersion == 0) "trimmed legacy rows must remain seen on the next scan"

  assert ((downloads zsh_quote "/Downloads/a b's.txt") == "'/Downloads/a b'\\''s.txt'") "clipboard paths must use POSIX single-quote encoding"

  let numeric = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" null true "12" false 1)
  assert ($numeric.observation == "attention" and $numeric.count == 12) "numeric Dock badges must retain their exact count"
  let marker = (dock-badge reduce "discord" "Discord" "com.example.discord" "D" null true "•" false 1)
  assert ($marker.observation == "attention" and $marker.count == 1 and $marker.badgeText == "•") "nonnumeric badges must remain visible markers"
  let unknown = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" $numeric false null false 2)
  assert ($unknown.observation == "unknown" and $unknown.count == 12 and ($unknown.items | length) == 1) "stopped applications must retain a prior latch without fabricating attention"
  let clear = (dock-badge reduce "slack" "Slack" "com.example.slack" "S" $unknown true "" false 3)
  assert ($clear.observation == "clear" and $clear.count == 0) "only an observed running empty badge may clear a latch"
}
