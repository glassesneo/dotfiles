# Filesystem observations are normalized here; fswatch only asks the reducer to rescan.
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

def pending_for [state: record, fingerprint: string] {
  try { $state.items? | default [] | where fingerprint == $fingerprint | first } catch { null }
}

# Given scans separated by time, expose only files whose metadata was unchanged
# for the selected stability window. The first scan is intentionally a baseline.
export def reduce [previous: any, snapshot: list<any>, now: int, stability_seconds: int] {
  let initial = $previous == null
  let prior = if $initial { empty_state $now } else { $previous }
  let current = (valid_entries $snapshot)
  let next_index = ($current | each {|entry|
    let old = (previous_index $prior $entry.fingerprint)
    if $initial {
      $entry | merge {stableSince: $now baseline: true}
    } else if $old != null and $old.size == $entry.size and $old.mtime == $entry.mtime {
      $entry | merge {stableSince: $old.stableSince baseline: ($old.baseline? | default false)}
    } else {
      $entry | merge {stableSince: $now baseline: false}
    }
  })
  let current_fingerprints = ($current | get fingerprint)
  let retained = ($prior.items? | default [] | where {|item| $item.fingerprint in $current_fingerprints })
  mut items = $retained
  if ($prior.initialized? | default false) {
    for candidate in $next_index {
      let already_pending = (pending_for {items: $items} $candidate.fingerprint)
      if not ($candidate.baseline? | default false) and $already_pending == null and ($now - $candidate.stableSince) >= $stability_seconds {
        $items = ($items | append {
          id: (random uuid)
          path: $candidate.path
          fingerprint: $candidate.fingerprint
          label: ($candidate.path | path basename)
          detail: ($candidate.path | path dirname)
          action: "copy-download"
          detectedAt: $now
        })
      }
    }
  }
  let ordered = ($items | sort-by --reverse detectedAt id)
  let count = ($ordered | length)
  {
    schemaVersion: 1
    source: "downloads"
    observation: (if $count > 0 { "attention" } else { "clear" })
    count: $count
    badgeText: null
    summary: (if $count == 1 { "1 completed download" } else { $"($count) completed downloads" })
    items: $ordered
    scanIndex: $next_index
    initialized: true
    updatedAt: $now
  }
}

export def visible_items [state: record, limit: int] {
  $state.items? | default [] | first $limit
}

export def zsh_quote [path: string] {
  let escaped = ($path | str replace --all "'" "'\\''")
  $"'($escaped)'"
}
