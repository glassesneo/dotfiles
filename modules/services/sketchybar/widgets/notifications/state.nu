use std/log

const state_dir = "@state-dir@"
const sketchybar_exe = "@sketchybar-exe@"

export def now [] { ^/bin/date +%s | into int }
export def provider_path [source: string] { [$state_dir $"($source).json"] | path join }
export def popup_path [] { [$state_dir "popup.json"] | path join }
def lock_path [source: string] { [$state_dir $"($source).lock"] | path join }

def valid_provider [value: any, source: string] {
  ($value | describe) =~ '^record' and ($value.schemaVersion? | default 0) == 1 and ($value.source? | default "") == $source
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

# Unsupported schemas are deliberately not interpreted. Downloads callers pass
# a baseline state, so recovery cannot create a first-run notification storm.
export def read_provider [source: string] {
  let path = (provider_path $source)
  if not ($path | path exists) { return null }
  let loaded = try { open $path } catch { null }
  if $loaded == null or not (valid_provider $loaded $source) {
    recover_corrupt $path $source
    return null
  }
  $loaded
}

export def read_popup [] {
  let path = (popup_path)
  if not ($path | path exists) { return {schemaVersion: 1 mainHovered: false popupHovered: false pinned: false generation: 0} }
  let loaded = try { open $path } catch { null }
  if $loaded == null or ($loaded.schemaVersion? | default 0) != 1 {
    recover_corrupt $path "popup"
    return {schemaVersion: 1 mainHovered: false popupHovered: false pinned: false generation: 0}
  }
  $loaded
}

def atomic_save [path: string, value: record] {
  mkdir $state_dir
  let temporary = $"($path).tmp-(random uuid)"
  $value | to json --raw | save --raw --force $temporary
  mv --force $temporary $path
}

export def write_provider [source: string, value: record] { atomic_save (provider_path $source) $value }
export def write_popup [value: record] { atomic_save (popup_path) $value }

def stale_lock [path: string] {
  if not ($path | path exists) { return false }
  try { ((now) - (^/usr/bin/stat -f %m $path | into int)) > 30 } catch { false }
}

# mkdir is atomic. A bounded retry and stale-lock recovery protects separate
# short-lived SketchyBar handlers without turning a failed lock into a write.
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

export def reset_popup [] {
  let popup = (read_popup)
  write_popup ($popup | merge {mainHovered: false popupHovered: false pinned: false generation: (($popup.generation? | default 0) + 1)})
}
