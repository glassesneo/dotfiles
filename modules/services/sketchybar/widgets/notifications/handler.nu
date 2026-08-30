use std/log
use ../../colors.nu
use state.nu
use providers/downloads.nu

const name = "notifications"
const sketchybar_exe = "@sketchybar-exe@"
const pbcopy = "@pbcopy@"
const open_app = "@open@"
const visible_limit = @visible-limit@
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
def acquire_render [] { state acquire "render" }
def release_render [] { state release "render" }

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
  let downloads_items = if ($downloads_state | length) == 0 { [] } else { downloads visible_items $downloads_state.0 $visible_limit }
  let social_states = ($attention | where source != "downloads")
  let social_items = ($social_states | each {|item| $item.items } | flatten)
  let projection = ((enabled_sources) | each {|source|
    let match = ($attention | where source == $source)
    let state_match = ($states | where source == $source)
    let signal = if $source == "downloads" and ($state_match | length) == 1 { $state_match.0.attentionVersion } else { 0 }
    {source: $source icon: (source_icon $source) count: (if ($match | length) == 1 { $match.0.count } else { 0 }) signal: $signal}
  })
  let total = ($projection | get count | math sum)
  {count: $total downloads: $downloads_items social: $social_items projection: $projection}
}

def settled_options [count: int] {
  if $count == 0 {
    [icon.y_offset=0 label="" label.drawing=off $"icon.color=($colors.text_muted)" $"background.border_color=($colors.island_border)"]
  } else {
    [icon.y_offset=0 $"label=($count)" label.drawing=on $"icon.color=($colors.status_warning)" $"label.color=($colors.status_warning)" $"background.border_color=($colors.active_indicator)"]
  }
}

def main_options [count: int] { [icon= ...(settled_options $count)] }

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
  if not (acquire_render) { return null }
  if not (state acquire "popup") { release_render; return null }
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
  release_render
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
  if not (acquire_render) { return }
  if not (state acquire "popup") { release_render; return }
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
  release_render
  if $next == null { return }
  let data = (aggregate)
  if $next.pinned and (popup_has_content $data) { popup_open }
  if not $next.pinned and not $next.mainHovered and not $next.popupHovered { popup_close }
}

def flash [color: string] {
  ^$sketchybar_exe --set $name $"background.border_color=($color)"
  sleep 700ms
  # Serialize the delayed stable repaint with commits and icon phases. Its
  # render→popup/provider lock order matches all animation critical sections.
  if not (acquire_render) { return }
  let repaint = try {
    let popup = (state read_popup_locked)
    if not $popup.animationActive {
      let data = (aggregate)
      ^$sketchybar_exe --set $name ...(main_options $data.count)
    }
    true
  } catch {|err|
    log warning $"Could not restore notifications flash: ($err.msg)"
    false
  }
  release_render
  $repaint | ignore
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

def prior_source [projection: list<any>, source: string] {
  let match = ($projection | where source == $source)
  if ($match | length) == 1 { $match.0 } else { {source: $source count: 0 signal: 0} }
}

# Downloads signals a new completion independently of its capped unresolved
# count; social providers retain their count-increase trigger semantics.
def triggering_source [previous: list<any>, current: list<any>] {
  let triggers = ($current | where {|entry|
    let prior = (prior_source $previous $entry.source)
    if $entry.source == "downloads" { $entry.signal > $prior.signal } else { $entry.count > $prior.count }
  })
  if ($triggers | length) == 0 { null } else { $triggers | first }
}

# Compare a persisted per-source projection while holding the popup lock. Equal
# renders leave an active animation alone; a real stable projection change
# invalidates it so stale later phases cannot paint an obsolete count.
def commit_render [data: record, forced: bool] {
  if not (state acquire "popup") { return null }
  let result = try {
    let current = (state read_popup)
    let projection_changed = $current.lastCount != $data.count or $current.sourceProjection != $data.projection
    let trigger = if $forced { null } else { triggering_source $current.sourceProjection $data.projection }
    let attention = $trigger != null
    let clear = not $forced and $data.count == 0 and $current.lastCount > 0
    let interrupt = not $forced and $current.animationActive and $projection_changed and not $attention and not $clear
    let invalidate = $attention or $clear or $forced or $interrupt
    let changed = $forced or $projection_changed or $invalidate
    let base = if $forced {
      $current | merge {mainHovered: false popupHovered: false pinned: false}
    } else { $current }
    let primary = if $trigger == null { $current.primarySource } else { $trigger.source }
    let next = ($base | upsert lastCount $data.count | upsert primarySource $primary | upsert sourceProjection $data.projection | upsert animationGeneration (if $invalidate { $current.animationGeneration + 1 } else { $current.animationGeneration }) | upsert animationActive (if $attention or $clear { true } else if $invalidate { false } else { $current.animationActive }) | upsert animationDeadline (if $attention or $clear { (state now) + 2 } else if $invalidate { 0 } else { $current.animationDeadline }) | upsert generation (if $forced { $current.generation + 1 } else { $current.generation }))
    if $changed { state write_popup $next }
    {popup: $next attention: $attention clear: $clear generation: $next.animationGeneration trigger: $trigger animating: $next.animationActive}
  } catch {|err|
    log warning $"Could not commit notifications render state: ($err.msg)"
    null
  }
  state release "popup"
  $result
}

# Call only while holding render: the popup generation check and SketchyBar
# icon command must be one critical section relative to a newer render commit.
def animation_current [generation: int] {
  let popup = (state read_popup_locked)
  $popup.animationGeneration == $generation and $popup.animationActive
}

def animation_alive [generation: int] {
  if not (acquire_render) { return false }
  let alive = (animation_current $generation)
  release_render
  $alive
}

def finish_animation [generation: int] {
  if not (acquire_render) { return }
  if (state acquire "popup") {
    try {
      let current = (state read_popup)
      if $current.animationGeneration == $generation and $current.animationActive {
        state write_popup ($current | upsert animationActive false | upsert animationDeadline 0)
      }
    } catch {|err| log warning $"Could not finish notifications animation: ($err.msg)" }
    state release "popup"
  }
  release_render
}

def animation_command [generation: int, arguments: list<string>] {
  if not (acquire_render) { return false }
  let result = try {
    if not (animation_current $generation) {
      {ok: false failed: false}
    } else {
      let command = (do { ^$sketchybar_exe ...$arguments } | complete)
      if $command.exit_code == 0 {
        {ok: true failed: false}
      } else {
        log warning $"SketchyBar notifications animation command failed (exit ($command.exit_code))"
        {ok: false failed: true}
      }
    }
  } catch {|err|
    log warning $"Could not issue SketchyBar notifications animation: ($err.msg)"
    {ok: false failed: true}
  }
  release_render
  if $result.failed { finish_animation $generation }
  $result.ok
}

def transparent_color [color: string] { $"0x00($color | str substring 4..)" }

# SketchyBar durations are 60 Hz frame counts. All waits exceed their matching
# duration: exit 8/60s → 150ms, reveal 10/60s → 180ms, then source hold 200ms.
const exit_frames = 8
const exit_wait = 150ms
const reveal_frames = 10
const reveal_wait = 180ms
const source_hold = 200ms

def play_attention [count: int, icon: string, generation: int] {
  let warning = $colors.status_warning
  let transparent_warning = (transparent_color $warning)
  let exit = ["--animate" "tanh" ($exit_frames | into string) "--set" $name "icon.y_offset=-4" $"icon.color=($transparent_warning)"]
  if not (animation_command $generation $exit) { return }
  sleep $exit_wait
  if not (animation_alive $generation) { return }
  # The glyph swap happens only while transparent; setup and reveal share one
  # CLI invocation so the nonanimated string cannot join an animation keyframe.
  let reveal = ["--set" $name $"icon=($icon)" "icon.y_offset=4" $"icon.color=($transparent_warning)" "--animate" "tanh" ($reveal_frames | into string) "--set" $name "icon.y_offset=0" $"icon.color=($warning)" $"label=($count)" "label.drawing=on" $"label.color=($warning)" $"background.border_color=($colors.active_indicator)"]
  if not (animation_command $generation $reveal) { return }
  sleep $reveal_wait
  if not (animation_alive $generation) { return }
  sleep $source_hold
  if not (animation_alive $generation) { return }
  if not (animation_command $generation $exit) { return }
  sleep $exit_wait
  if not (animation_alive $generation) { return }
  let bell = ["--set" $name "icon=" "icon.y_offset=4" $"icon.color=($transparent_warning)" "--animate" "tanh" ($reveal_frames | into string) "--set" $name ...(settled_options $count)]
  if not (animation_command $generation $bell) { return }
  sleep $reveal_wait
  if not (animation_alive $generation) { return }
  finish_animation $generation
}

def play_clear [generation: int] {
  let warning_transparent = (transparent_color $colors.status_warning)
  let muted = $colors.text_muted
  let transparent_muted = (transparent_color $muted)
  let exit = ["--animate" "tanh" ($exit_frames | into string) "--set" $name "icon.y_offset=-4" $"icon.color=($warning_transparent)"]
  if not (animation_command $generation $exit) { return }
  sleep $exit_wait
  if not (animation_alive $generation) { return }
  let bell = ["--set" $name "icon=" "icon.y_offset=4" $"icon.color=($transparent_muted)" "--animate" "tanh" ($reveal_frames | into string) "--set" $name ...(settled_options 0)]
  if not (animation_command $generation $bell) { return }
  sleep $reveal_wait
  if not (animation_alive $generation) { return }
  finish_animation $generation
}

# Render preparation is serialized from provider snapshots through popup commit,
# rows, and any stable icon write. Sleeps and animation waits deliberately run
# after release so a newer render can invalidate the old generation promptly.
def render [--forced] {
  if not (acquire_render) { return }
  let prepared = try {
    let data = (aggregate)
    let transition = (commit_render $data $forced)
    if $transition == null { null } else {
      render_rows $data
      if $forced { popup_close } else if not (popup_has_content $data) and not $transition.popup.pinned { popup_close } else if (popup_has_content $data) and ($transition.popup.pinned or $transition.popup.mainHovered or $transition.popup.popupHovered) { popup_open }
      if not $transition.attention and not $transition.clear and not $transition.animating {
        ^$sketchybar_exe --set $name ...(main_options $data.count)
      }
      {data: $data transition: $transition}
    }
  } catch {|err|
    log warning $"Could not prepare notifications render: ($err.msg)"
    null
  }
  release_render
  if $prepared == null { return }
  if $prepared.transition.attention {
    play_attention $prepared.data.count $prepared.transition.trigger.icon $prepared.transition.generation
  } else if $prepared.transition.clear {
    play_clear $prepared.transition.generation
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
