use std/log
use ../../colors.nu
use state.nu
use providers/downloads.nu

const name = "notifications"
const sketchybar_exe = "@sketchybar-exe@"
const pbcopy = "@pbcopy@"
const open_app = "@open@"
def apps [] { '@apps-json@' | from json }
def enabled_sources [] { '@enabled-sources-json@' | from json }

def contributes_attention [provider: record] {
  if $provider.observation == "attention" { true } else if $provider.observation == "unknown" {
    $provider.count != null and $provider.count > 0 and (($provider.items | length) > 0)
  } else { false }
}

def provider_states [] {
  (enabled_sources) | each {|source| state read_provider_locked $source } | compact
}

def attention_states [states: list<any>] { $states | where {|provider| contributes_attention $provider } }

def popup_has_content [data: record] { $data.count > 0 or (($data.downloads | length) > 0) }

def source_icon [source: string] {
  if $source == "downloads" { "" } else {
    let app = ((apps) | where id == $source)
    if ($app | length) == 1 { $app.0.icon } else { "" }
  }
}

def aggregate [] {
  let states = (provider_states)
  let attention = (attention_states $states)
  # Downloads history is independently visible while idle; its count remains
  # only unresolved available attention, unlike its retained popup rows.
  let downloads_state = ($states | where source == "downloads")
  let downloads_items = if ($downloads_state | length) == 0 { [] } else { downloads visible_items $downloads_state.0 3 }
  let social_states = ($attention | where source != "downloads")
  let social_items = ($social_states | each {|item| $item.items } | flatten)
  let projection = ((enabled_sources) | each {|source|
    let match = ($attention | where source == $source)
    {source: $source icon: (source_icon $source) count: (if ($match | length) == 1 { $match.0.count } else { 0 })}
  })
  let total = ($projection | get count | math sum)
  {count: $total downloads: $downloads_items social: $social_items projection: $projection}
}

def main_options [count: int] {
  if $count == 0 {
    [icon= icon.y_offset=0 icon.alpha=1 label="" label.drawing=off $"icon.color=($colors.text_muted)" $"background.border_color=($colors.island_border)"]
  } else {
    [icon= icon.y_offset=0 icon.alpha=1 $"label=($count)" label.drawing=on $"icon.color=($colors.status_warning)" $"label.color=($colors.status_warning)" $"background.border_color=($colors.active_indicator)"]
  }
}

def row_name [id: string] { $"notifications.row.($id)" }
def trunc [text: string] { $text | str substring 0..70 }
def popup_open [] { ^$sketchybar_exe --set $name popup.drawing=on }
def popup_close [] { ^$sketchybar_exe --set $name popup.drawing=off }

def render_rows [data: record] {
  try { ^$sketchybar_exe --remove '/notifications\.row\..*/' } catch {}
  for item in $data.downloads {
    let row = (row_name $item.id)
    ^$sketchybar_exe --add item $row $"popup.($name)"
    let state_label = if $item.status == "pending" { "Pending" } else if $item.status == "resolved" { "Copied — re-copy" } else { "Unavailable" }
    let label = if ($item.detail | is-empty) { $"[($state_label)] ($item.label)" } else { $"[($state_label)] ($item.label) — ($item.detail)" }
    let color = if $item.status == "pending" { $colors.status_warning } else if $item.status == "resolved" { $colors.text_muted } else { $colors.status_error }
    ^$sketchybar_exe --set $row icon= $"icon.color=($color)" $"label=(trunc $label)" $"label.color=($color)" icon.padding_left=8 label.padding_right=8 script="__script_path__ popup-event" $"click_script=__script_path__ copy-download ($item.id)"
    ^$sketchybar_exe --subscribe $row mouse.entered mouse.exited
  }
  for item in $data.social {
    let row = (row_name $item.id)
    let detail = ($item.detail? | default "")
    let label = if ($detail | is-empty) { $item.label } else { $"($item.label) ($detail)" }
    ^$sketchybar_exe --add item $row $"popup.($name)"
    ^$sketchybar_exe --set $row $"icon=($item.icon)" $"label=(trunc $label)" icon.padding_left=8 label.padding_right=8 script="__script_path__ popup-event" $"click_script=__script_path__ activate-app ($item.id)"
    ^$sketchybar_exe --subscribe $row mouse.entered mouse.exited
  }
}

# Every popup RMW takes the popup lock. A failed write returns null and leaves
# both the previous file and the visible state untouched.
def update_popup [patch: record] {
  if not (state acquire "popup") { return null }
  let result = try {
    let current = (state read_popup)
    let next = ($current | merge $patch | upsert generation (($current.generation) + 1))
    state write_popup $next
    $next
  } catch {|err|
    log warning $"Could not update notifications popup state: ($err.msg)"
    null
  }
  state release "popup"
  $result
}

def set_region [region: string, value: bool] {
  if $region == "mainHovered" { update_popup {mainHovered: $value} } else { update_popup {popupHovered: $value} }
}

def clear_global_hover [] { update_popup {mainHovered: false popupHovered: false} }

def delayed_visibility [open: bool, generation: int, delay: duration] {
  sleep $delay
  let popup = (state read_popup_locked)
  if $popup.generation != $generation { return }
  if $open {
    let data = (aggregate)
    if ($popup.pinned or $popup.mainHovered or $popup.popupHovered) and (popup_has_content $data) { popup_open }
  } else if not $popup.pinned and not $popup.mainHovered and not $popup.popupHovered {
    popup_close
  }
}

def handle_main_hover [entered: bool] {
  let popup = (set_region "mainHovered" $entered)
  if $popup == null { return }
  if $entered { delayed_visibility true $popup.generation 500ms } else { delayed_visibility false $popup.generation 200ms }
}

def handle_popup_hover [entered: bool] {
  let popup = (set_region "popupHovered" $entered)
  if $popup == null { return }
  if $entered { popup_open } else { delayed_visibility false $popup.generation 200ms }
}

def toggle_pin [] {
  if not (state acquire "popup") { return }
  let next = try {
    let current = (state read_popup)
    let value = ($current | upsert pinned (not $current.pinned) | upsert generation ($current.generation + 1))
    state write_popup $value
    $value
  } catch {|err|
    log warning $"Could not toggle notifications popup: ($err.msg)"
    null
  }
  state release "popup"
  if $next == null { return }
  let data = (aggregate)
  if $next.pinned and (popup_has_content $data) { popup_open }
  if not $next.pinned and not $next.mainHovered and not $next.popupHovered { popup_close }
}

def flash [color: string] {
  ^$sketchybar_exe --set $name $"background.border_color=($color)"
  sleep 700ms
  let data = (aggregate)
  ^$sketchybar_exe --set $name ...(main_options $data.count)
}

def download_state [current: record, items: list<any>] {
  let count = ($items | where status == "pending" | length)
  $current | upsert items $items | upsert count $count | upsert observation (if $count == 0 { "clear" } else { "attention" }) | upsert summary (if $count == 0 { "No download attention" } else if $count == 1 { "1 completed download needs attention" } else { $"($count) completed downloads need attention" }) | upsert updatedAt (state now)
}

# Stable IDs are looked up while holding the Downloads lock. Clipboard success
# resolves attention without erasing history; unavailable records are never
# passed to pbcopy and remain visible until ordinary last-three eviction.
def copy_download [id: string] {
  if not (state acquire "downloads") { flash $colors.status_error; return }
  let result = try {
    let current = (state read_provider "downloads")
    let matches = if $current == null { [] } else { $current.items | where id == $id }
    if ($matches | length) != 1 { {changed: false success: false} } else {
      let item = $matches.0
      if $item.status == "unavailable" {
        log warning $"Download history row ($id) is unavailable"
        {changed: false success: false}
      } else {
        let regular = (do { ^/bin/test -f $item.path } | complete)
        let file_type = try { ^/usr/bin/stat -f %HT $item.path | str trim } catch { "" }
        if $regular.exit_code != 0 or $file_type != "Regular File" {
          let items = ($current.items | each {|row| if $row.id == $id { $row | upsert status "unavailable" } else { $row } })
          state write_provider "downloads" (download_state $current $items)
          log warning $"Download history row ($id) became unavailable"
          {changed: true success: false}
        } else {
          let copied = (do { downloads zsh_quote $item.path | ^$pbcopy } | complete)
          if $copied.exit_code != 0 { {changed: false success: false} } else {
            let items = ($current.items | each {|row| if $row.id == $id { $row | upsert status "resolved" } else { $row } })
            state write_provider "downloads" (download_state $current $items)
            {changed: true success: true}
          }
        }
      }
    }
  } catch {|err|
    log warning $"Could not resolve Download row ($id): ($err.msg)"
    {changed: false success: false}
  }
  state release "downloads"
  if $result.changed { state publish }
  if $result.success { flash $colors.status_success } else { flash $colors.status_error }
}

def activate_app [id: string] {
  let allowed = ((apps) | where {|app| $app.id == $id and $id in (enabled_sources) })
  if ($allowed | length) != 1 { log warning $"Rejected unallowlisted social app action: ($id)"; flash $colors.status_error; return }
  let result = (do { ^$open_app -b $allowed.0.bundleId } | complete)
  if $result.exit_code != 0 { log warning $"Could not activate ($allowed.0.label)"; flash $colors.status_error }
}

def prior_source_count [projection: list<any>, source: string] {
  let match = ($projection | where source == $source)
  if ($match | length) == 1 { $match.0.count } else { 0 }
}

def triggering_source [previous: list<any>, current: list<any>] {
  let increases = ($current | where {|entry| $entry.count > (prior_source_count $previous $entry.source) })
  if ($increases | length) == 0 { null } else { $increases | first }
}

# Compare a persisted per-source projection while holding the popup lock. This
# selects the provider that actually gained attention even if Downloads already
# has pending rows; equal re-events select nothing and therefore never replay.
def commit_render [data: record, forced: bool] {
  if not (state acquire "popup") { return null }
  let result = try {
    let current = (state read_popup)
    let trigger = if $forced { null } else { triggering_source $current.sourceProjection $data.projection }
    let attention = $trigger != null
    let clear = not $forced and $data.count == 0 and $current.lastCount > 0
    let changed = $forced or $current.lastCount != $data.count or $current.sourceProjection != $data.projection or $attention or $clear
    let base = if $forced {
      $current | merge {mainHovered: false popupHovered: false pinned: false}
    } else { $current }
    let primary = if $trigger == null { $current.primarySource } else { $trigger.source }
    let next = ($base | upsert lastCount $data.count | upsert primarySource $primary | upsert sourceProjection $data.projection | upsert animationGeneration (if $attention or $clear or $forced { $current.animationGeneration + 1 } else { $current.animationGeneration }) | upsert generation (if $forced { $current.generation + 1 } else { $current.generation }))
    if $changed { state write_popup $next }
    {popup: $next attention: $attention clear: $clear generation: $next.animationGeneration trigger: $trigger}
  } catch {|err|
    log warning $"Could not commit notifications render state: ($err.msg)"
    null
  }
  state release "popup"
  $result
}

def animation_current [generation: int] {
  let popup = (state read_popup_locked)
  $popup.animationGeneration == $generation
}

# SketchyBar durations are 60 Hz frame counts. Keep every wait beyond the
# matching duration so a same-property phase can finish before a glyph swap or
# a later queue replaces it. The restrained offsets stay within the 32 px bar.
const attention_frames = 18
const attention_wait = 330ms
const clear_frames = 10
const clear_wait = 190ms

def play_attention [count: int, icon: string, generation: int] {
  if not (animation_current $generation) { return }
  # Let the old glyph visibly leave before switching strings. Numeric alpha and
  # offset animate together; glyphs themselves switch immediately by design.
  ^$sketchybar_exe --animate tanh $attention_frames --set $name icon.y_offset=-4 icon.alpha=0
  sleep $attention_wait
  if not (animation_current $generation) { return }
  ^$sketchybar_exe --set $name $"icon=($icon)" icon.y_offset=4 icon.alpha=0
  ^$sketchybar_exe --animate tanh $attention_frames --set $name icon.y_offset=0 icon.alpha=1
  sleep $attention_wait
  if not (animation_current $generation) { return }
  # The source icon has appeared, then yields to the quiet shared pending icon.
  ^$sketchybar_exe --animate tanh $clear_frames --set $name icon.y_offset=-3 icon.alpha=0
  sleep $clear_wait
  if not (animation_current $generation) { return }
  ^$sketchybar_exe --set $name icon= icon.y_offset=3 icon.alpha=0
  ^$sketchybar_exe --animate tanh $clear_frames --set $name ...(main_options $count)
}

def play_clear [generation: int] {
  if not (animation_current $generation) { return }
  ^$sketchybar_exe --animate tanh $clear_frames --set $name icon.y_offset=-3 icon.alpha=0
  sleep $clear_wait
  if not (animation_current $generation) { return }
  ^$sketchybar_exe --set $name icon= icon.y_offset=3 icon.alpha=0
  ^$sketchybar_exe --animate tanh $clear_frames --set $name ...(main_options 0)
}

def render [--forced] {
  let data = (aggregate)
  let transition = (commit_render $data $forced)
  if $transition == null { return }
  render_rows $data
  if $forced { popup_close } else if not (popup_has_content $data) and not $transition.popup.pinned { popup_close } else if (popup_has_content $data) and ($transition.popup.pinned or $transition.popup.mainHovered or $transition.popup.popupHovered) { popup_open }
  if $transition.attention {
    play_attention $data.count $transition.trigger.icon $transition.generation
  } else if $transition.clear {
    play_clear $transition.generation
  } else {
    ^$sketchybar_exe --set $name ...(main_options $data.count)
  }
}

def main [action?: string, arg?: string] {
  match ($action | default "event") {
    "copy-download" => { copy_download $arg; render }
    "activate-app" => { activate_app $arg }
    "click-main" => { toggle_pin }
    "popup-event" => {
      match ($env.SENDER? | default "") {
        "mouse.entered" => { handle_popup_hover true }
        "mouse.exited" => { handle_popup_hover false }
        _ => {}
      }
    }
    _ => {
      match ($env.SENDER? | default "") {
        "mouse.entered" => { handle_main_hover true }
        "mouse.exited" => { handle_main_hover false }
        "mouse.exited.global" => { let popup = (clear_global_hover); if $popup != null and not $popup.pinned { popup_close } }
        "forced" => { render --forced }
        "notifications_changed" => { render }
        "display_change" => { render --forced }
        _ => { render }
      }
    }
  }
}
