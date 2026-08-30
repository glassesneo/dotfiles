use std/log
use providers/downloads.nu

const state_dir = "@state-dir@"
const sketchybar_exe = "@sketchybar-exe@"

export def now [] { ^/bin/date +%s | into int }
export def provider_path [source: string] { [$state_dir $"($source).json"] | path join }
export def popup_path [] { [$state_dir "popup.json"] | path join }
def lock_path [source: string] { [$state_dir $"($source).lock"] | path join }

def is_record [value: any] { ($value | describe) =~ '^record' }
def is_int [value: any] { ($value | describe) == "int" }
def is_string [value: any] { ($value | describe) == "string" }
def is_bool [value: any] { ($value | describe) == "bool" }
def is_list [value: any] { ($value | describe) =~ '^(list|table)' }

def valid_item [item: any, source: string] {
  if not (is_record $item) { return false }
  if not (is_string ($item.id? | default null)) or not (is_string ($item.label? | default null)) { return false }
  if not ("detail" in ($item | columns)) or not (($item.detail == null) or (is_string $item.detail)) { return false }
  let action = ($item.action? | default null)
  if not ($action in ["copy-download" "activate-app" "none"]) { return false }
  if $source == "downloads" {
    (is_string ($item.path? | default null)) and (is_string ($item.fingerprint? | default null)) and (is_int ($item.detectedAt? | default null)) and (($item.status? | default null) in ["pending" "resolved" "unavailable"]) and $action == "copy-download"
  } else {
    (is_string ($item.bundleId? | default null)) and (is_string ($item.icon? | default null)) and $action == "activate-app"
  }
}

def valid_scan_entry [entry: any] {
  (is_record $entry) and (is_string ($entry.path? | default null)) and (is_string ($entry.fingerprint? | default null)) and (is_int ($entry.size? | default null)) and (is_int ($entry.mtime? | default null)) and (is_int ($entry.stableSince? | default null)) and (is_bool ($entry.baseline? | default null)) and (is_bool ($entry.notified? | default null))
}

# Provider records are a persisted internal protocol. Validate every field that
# later drives a UI row or action; a merely versioned-but-malformed file is not
# safe to retry forever.
def valid_provider [value: any, source: string] {
  if not (is_record $value) { return false }
  if ($value.schemaVersion? | default 0) != 1 or ($value.source? | default "") != $source { return false }
  if not (($value.observation? | default "") in ["clear" "attention" "unknown"]) { return false }
  let count = ($value.count? | default null)
  if $count != null and (not (is_int $count) or $count < 0) { return false }
  if not (is_string ($value.summary? | default null)) or not (is_int ($value.updatedAt? | default null)) { return false }
  let items = ($value.items? | default null)
  if not (is_list $items) or not ($items | all {|item| valid_item $item $source }) { return false }
  if $source == "downloads" {
    let index = ($value.scanIndex? | default null)
    let pending = ($items | where status == "pending" | length)
    (is_int $count) and $count == $pending and (($value.observation == "clear" and $count == 0) or ($value.observation == "attention" and $count > 0)) and (is_bool ($value.initialized? | default null)) and (is_list $index) and ($index | all {|entry| valid_scan_entry $entry }) and ($value.badgeText? | default null) == null
  } else {
    let badge = ($value.badgeText? | default null)
    let badge_valid = $badge == null or (is_string $badge)
    if not $badge_valid { return false }
    if $value.observation == "attention" {
      (is_int $count) and $count > 0 and (($items | length) > 0)
    } else if $value.observation == "clear" {
      $count == 0 and (($items | length) == 0) and $badge == null
    } else {
      ($count == null and (($items | length) == 0) and $badge == null) or ((is_int $count) and $count > 0 and (($items | length) > 0))
    }
  }
}

export def default_popup [] {
  {schemaVersion: 1 mainHovered: false popupHovered: false pinned: false generation: 0 animationGeneration: 0 lastCount: 0 primarySource: "" sourceProjection: []}
}

def valid_source_projection [entry: any] {
  (is_record $entry) and (is_string ($entry.source? | default null)) and (is_string ($entry.icon? | default null)) and (is_int ($entry.count? | default null)) and $entry.count >= 0
}

def valid_popup [value: any] {
  (is_record $value) and ($value.schemaVersion? | default 0) == 1 and (is_bool ($value.mainHovered? | default null)) and (is_bool ($value.popupHovered? | default null)) and (is_bool ($value.pinned? | default null)) and (is_int ($value.generation? | default null)) and (is_int ($value.animationGeneration? | default null)) and (is_int ($value.lastCount? | default null)) and (is_string ($value.primarySource? | default null)) and (is_list ($value.sourceProjection? | default null)) and ($value.sourceProjection | all {|entry| valid_source_projection $entry })
}

def recover_corrupt [path: string, source: string] {
  let recovery = $"($path).corrupt-(now)"
  try {
    mv --force $path $recovery
    log warning $"Recovered malformed notifications state for ($source) at ($recovery)"
  } catch {|err|
    log warning $"Could not move malformed notifications state for ($source): ($err.msg)"
  }
}

# Read-only snapshots never rename corrupt input. They are safe while another
# process holds the lock because provider publication is an atomic rename.
def normalized_provider [value: any, source: string] {
  if $value == null { return null }
  if $source == "downloads" {
    try { downloads normalize_state $value } catch { null }
  } else { $value }
}

def provider_snapshot [source: string] {
  let path = (provider_path $source)
  if not ($path | path exists) { return null }
  let loaded = try { open $path } catch { null }
  let normalized = (normalized_provider $loaded $source)
  if $normalized == null or not (valid_provider $normalized $source) { null } else { $normalized }
}
def popup_snapshot [] {
  let path = (popup_path)
  if not ($path | path exists) { return (default_popup) }
  let loaded = try { open $path } catch { null }
  if $loaded == null or not (valid_popup $loaded) { null } else { $loaded }
}

export def read_provider [source: string] {
  let path = (provider_path $source)
  let loaded = if ($path | path exists) { try { open $path } catch { null } } else { null }
  let value = (normalized_provider $loaded $source)
  if $value != null and (valid_provider $value $source) {
    # Downloads normalization is an explicit schema-v1 migration. Callers hold
    # the source lock, so publishing it here preserves seen fingerprints across
    # a restart without discarding legacy pending rows.
    if $source == "downloads" and $loaded != $value {
      atomic_save $path $value
      log info "Normalized legacy Downloads notifications state"
    }
    return $value
  }
  if ($path | path exists) { recover_corrupt $path $source }
  null
}

export def read_popup [] {
  let value = (popup_snapshot)
  if $value != null { return $value }
  let path = (popup_path)
  if ($path | path exists) { recover_corrupt $path "popup" }
  default_popup
}

# Recovery can rename corrupt input, so successful lock acquisition is required
# for quarantine. On bounded lock failure use the last atomically published,
# validated snapshot rather than treating another provider as cleared.
export def read_provider_locked [source: string] {
  if not (acquire $source) {
    let fallback = (provider_snapshot $source)
    if $fallback == null { log warning $"No safe notifications snapshot available for locked source ($source)" }
    return $fallback
  }
  let value = (read_provider $source)
  release $source
  $value
}
export def read_popup_locked [] {
  if not (acquire "popup") {
    let fallback = (popup_snapshot)
    if $fallback == null { log warning "No safe notifications popup snapshot available while locked"; return (default_popup) }
    return $fallback
  }
  let value = (read_popup)
  release "popup"
  $value
}

def atomic_save [path: string, value: record] {
  mkdir $state_dir
  let temporary = $"($path).tmp-(random uuid)"
  let published = try {
    $value | to json --raw | save --raw --force $temporary
    mv --force $temporary $path
    true
  } catch {|err|
    log warning $"Could not atomically save notifications state ($path): ($err.msg)"
    false
  }
  if ($temporary | path exists) { try { rm --force $temporary } }
  if not $published { error make {msg: $"notifications state write failed: ($path)"} }
}

export def write_provider [source: string, value: record] {
  if not (valid_provider $value $source) { error make {msg: $"refusing invalid provider state for ($source)"} }
  atomic_save (provider_path $source) $value
}
export def write_popup [value: record] {
  if not (valid_popup $value) { error make {msg: "refusing invalid popup state"} }
  atomic_save (popup_path) $value
}

def stale_lock [path: string] {
  if not ($path | path exists) { return false }
  try { ((now) - (^/usr/bin/stat -f %m $path | into int)) > 30 } catch { false }
}

export def acquire [source: string] {
  mkdir $state_dir
  let path = (lock_path $source)
  for _ in 0..20 {
    if (stale_lock $path) { try { rm -rf $path } }
    let acquired = try { ^/bin/mkdir $path; true } catch { false }
    if $acquired { return true }
    sleep 25ms
  }
  log warning $"Could not acquire notifications lock for ($source)"
  false
}

export def release [source: string] {
  let path = (lock_path $source)
  if ($path | path exists) { try { rm -rf $path } }
}

export def publish [] { try { ^$sketchybar_exe --trigger notifications_changed | ignore } catch {} }
