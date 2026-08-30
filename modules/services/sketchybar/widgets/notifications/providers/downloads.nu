# Filesystem observations are normalized here; fswatch only asks the reducer to rescan.
const history_limit = 3

export def ignored_temporary [path: string] {
  let file = ($path | path basename)
  ($file | str starts-with ".") or ([".crdownload" ".download" ".part" ".tmp"] | any {|suffix| $file | str ends-with $suffix })
}

export def fingerprint [entry: record] {
  $entry.fingerprint? | default $"($entry.path):($entry.size):($entry.mtime)"
}

export def empty_state [now: int] {
  {
    schemaVersion: 1
    source: "downloads"
    observation: "clear"
    count: 0
    badgeText: null
    summary: "No completed downloads"
    items: []
    scanIndex: []
    attentionVersion: 0
    initialized: false
    updatedAt: $now
  }
}

def valid_entries [snapshot: list<any>] {
  $snapshot
  | where {|entry| ($entry.regular? | default true) and not (ignored_temporary $entry.path) }
  | each {|entry| $entry | upsert fingerprint (fingerprint $entry) }
}

def previous_index [state: record, fingerprint: string] {
  try { $state.scanIndex? | default [] | where fingerprint == $fingerprint | first } catch { null }
}

def historical_for [state: record, fingerprint: string] {
  try { $state.items? | default [] | where fingerprint == $fingerprint | first } catch { null }
}

def attention_count [items: list<any>] { $items | where status == "pending" | length }

def summary [count: int] {
  if $count == 0 { "No download attention" } else if $count == 1 { "1 completed download needs attention" } else { $"($count) completed downloads need attention" }
}

# Given scans separated by time, expose only files whose metadata was unchanged
# for the selected stability window. The first scan is intentionally a baseline.
# `scanIndex.notified` is a durable seen set for files still present: resolving a
# history row must not turn the next scan into a new completion notification.
export def reduce [previous: any, snapshot: list<any>, now: int, stability_seconds: int] {
  let initial = $previous == null
  let prior = if $initial { empty_state $now } else { normalize_state $previous }
  let current = (valid_entries $snapshot)
  let next_index = ($current | each {|entry|
    let old = (previous_index $prior $entry.fingerprint)
    let history = (historical_for $prior $entry.fingerprint)
    if $initial {
      $entry | merge {stableSince: $now baseline: true notified: true}
    } else if $old != null and $old.size == $entry.size and $old.mtime == $entry.mtime {
      $entry | merge {stableSince: $old.stableSince baseline: ($old.baseline? | default false) notified: ($old.notified? | default (($old.baseline? | default false) or $history != null))}
    } else {
      $entry | merge {stableSince: $now baseline: false notified: false}
    }
  })
  let current_fingerprints = ($current | get fingerprint)
  # History survives disappearance. A path no longer represented by the same
  # regular-file fingerprint is permanently unavailable, rather than discarded
  # or silently redirected to a replacement/symlink.
  let retained = ($prior.items? | default [] | each {|item|
    if $item.status == "unavailable" or $item.fingerprint in $current_fingerprints {
      $item
    } else {
      $item | upsert status "unavailable"
    }
  })
  let additions = ($next_index | where {|candidate|
    not ($candidate.baseline? | default false) and not ($candidate.notified? | default false) and ($now - $candidate.stableSince) >= $stability_seconds
  })
  let notified = ($additions | get fingerprint)
  let completed = ($additions | each {|candidate|
    {
      id: (random uuid)
      path: $candidate.path
      fingerprint: $candidate.fingerprint
      label: ($candidate.path | path basename)
      detail: ($candidate.path | path dirname)
      action: "copy-download"
      status: "pending"
      detectedAt: $now
    }
  })
  let items = (($retained | append $completed) | sort-by --reverse detectedAt id | first $history_limit)
  let finalized_index = ($next_index | each {|entry|
    if $entry.fingerprint in $notified or (historical_for {items: $items} $entry.fingerprint) != null {
      $entry | upsert notified true
    } else { $entry }
  })
  let count = (attention_count $items)
  let attention_version = ($prior.attentionVersion? | default 0) + (if ($additions | length) > 0 { 1 } else { 0 })
  {
    schemaVersion: 1
    source: "downloads"
    observation: (if $count > 0 { "attention" } else { "clear" })
    count: $count
    badgeText: null
    summary: (summary $count)
    items: $items
    scanIndex: $finalized_index
    attentionVersion: $attention_version
    initialized: true
    updatedAt: $now
  }
}

# Schema-v1 originally stored only pending rows and did not persist either a
# completion signal or whether a stable fingerprint had already notified.
# Normalize in place without dropping pending rows, then cap history at three.
# If an old index has no notified fields at all, mark its whole known set seen:
# avoiding a baseline notification storm is safer than rediscovering old rows
# trimmed by the new history bound.
export def normalize_state [value: record] {
  let raw_items = ($value.items? | default [])
  let items = ($raw_items | each {|item| $item | upsert status ($item.status? | default "pending") } | sort-by --reverse detectedAt id | first $history_limit)
  let raw_index = ($value.scanIndex? | default [])
  let legacy_index = ($raw_index | all {|entry| not ("notified" in ($entry | columns)) })
  let index = ($raw_index | each {|entry|
    let retained = (try { $items | where fingerprint == $entry.fingerprint | length } catch { 0 })
    let seen = if $legacy_index { true } else { ($entry.baseline? | default false) or $retained > 0 }
    $entry | upsert notified ($entry.notified? | default $seen)
  })
  let count = (attention_count $items)
  $value
  | upsert items $items
  | upsert scanIndex $index
  | upsert attentionVersion ($value.attentionVersion? | default 0)
  | upsert count $count
  | upsert observation (if $count == 0 { "clear" } else { "attention" })
  | upsert summary (summary $count)
  | upsert badgeText null
}

export def visible_items [state: record, limit: int] {
  $state.items? | default [] | first $limit
}

export def zsh_quote [path: string] {
  let escaped = ($path | str replace --all "'" "'\\''")
  $"'($escaped)'"
}
