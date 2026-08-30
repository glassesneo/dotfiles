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

def source_names [] { ["downloads"] ++ ((apps) | get id) }

def attention_states [] {
  source_names | each {|source| state read_provider $source } | compact | where observation == "attention"
}

def aggregate [] {
  let states = (attention_states)
  let downloads_state = ($states | where source == "downloads")
  let downloads_items = if ($downloads_state | length) == 0 { [] } else { downloads visible_items $downloads_state.0 $visible_limit }
  let social_items = ($states | where source != "downloads" | each {|item| $item.items? | default [] } | flatten)
  let total = ($states | each {|item| $item.count? | default 0 } | math sum)
  {count: $total downloads: $downloads_items social: $social_items}
}

def main_options [count: int] {
  if $count == 0 {
    [icon= label="" label.drawing=off $"icon.color=($colors.text_muted)" $"background.border_color=($colors.island_border)"]
  } else {
    [icon= $"label=($count)" label.drawing=on $"icon.color=($colors.status_warning)" $"label.color=($colors.status_warning)" $"background.border_color=($colors.active_indicator)"]
  }
}

def row_name [id: string] { $"notifications.row.($id)" }

def trunc [text: string] { $text | str substring 0..70 }

def render_rows [data: record] {
  try { ^$sketchybar_exe --remove '/notifications\.row\..*/' } catch {}
  for item in $data.downloads {
    let row = (row_name $item.id)
    ^$sketchybar_exe --add item $row $"popup.($name)"
    ^$sketchybar_exe --set $row icon= $"label=(trunc $item.label)" $"label.tooltip=($item.detail)" icon.padding_left=8 label.padding_right=8 script="__script_path__ popup-event" $"click_script=__script_path__ copy-download ($item.id)"
    ^$sketchybar_exe --subscribe $row mouse.entered mouse.exited mouse.clicked
  }
  for item in $data.social {
    let row = (row_name $item.id)
    let detail = ($item.detail? | default "")
    let label = if ($detail | is-empty) { $item.label } else { $"($item.label) ($detail)" }
    ^$sketchybar_exe --add item $row $"popup.($name)"
    ^$sketchybar_exe --set $row $"icon=($item.icon)" $"label=(trunc $label)" icon.padding_left=8 label.padding_right=8 script="__script_path__ popup-event" $"click_script=__script_path__ activate-app ($item.id)"
    ^$sketchybar_exe --subscribe $row mouse.entered mouse.exited mouse.clicked
  }
}

def popup_open [] { ^$sketchybar_exe --set $name popup.drawing=on }
def popup_close [] { ^$sketchybar_exe --set $name popup.drawing=off }

def save_popup [popup: record] { state write_popup $popup }

def set_region [region: string, value: bool] {
  if not (state acquire "popup") { return }
  let popup = (state read_popup)
  let next = ($popup | upsert $region $value | upsert generation (($popup.generation? | default 0) + 1))
  save_popup $next
  state release "popup"
  $next
}

def delayed_visibility [open: bool, generation: int, delay: duration] {
  sleep $delay
  let popup = (state read_popup)
  if ($popup.generation? | default (-1)) != $generation { return }
  if $open {
    if ($popup.pinned or $popup.mainHovered or $popup.popupHovered) and (aggregate).count > 0 { popup_open }
  } else if not $popup.pinned and not $popup.mainHovered and not $popup.popupHovered {
    popup_close
  }
}

def handle_main_hover [entered: bool] {
  let popup = (set_region "mainHovered" $entered)
  if $entered { delayed_visibility true $popup.generation 500ms } else { delayed_visibility false $popup.generation 200ms }
}

def handle_popup_hover [entered: bool] {
  let popup = (set_region "popupHovered" $entered)
  if $entered { popup_open } else { delayed_visibility false $popup.generation 200ms }
}

def toggle_pin [] {
  if not (state acquire "popup") { return }
  let popup = (state read_popup)
  let next = ($popup | upsert pinned (not $popup.pinned) | upsert generation (($popup.generation? | default 0) + 1))
  save_popup $next
  state release "popup"
  if $next.pinned and (aggregate).count > 0 { popup_open }
  if not $next.pinned and not $next.mainHovered and not $next.popupHovered { popup_close }
}

def flash [color: string] {
  ^$sketchybar_exe --set $name $"background.border_color=($color)"
  sleep 700ms
  let total = (aggregate).count
  ^$sketchybar_exe --set $name ...(main_options $total)
}

def copy_download [id: string] {
  if not (state acquire "downloads") { flash $colors.status_error; return }
  let current = (state read_provider "downloads")
  let matches = if $current == null { [] } else { $current.items | where id == $id }
  if ($matches | length) != 1 {
    state release "downloads"
    log warning $"Download row no longer exists: ($id)"
    flash $colors.status_error
    return
  }
  let item = $matches.0
  let exists = (do { ^/usr/bin/test -f $item.path } | complete)
  if $exists.exit_code != 0 {
    let next = ($current | upsert items ($current.items | where id != $id) | upsert count (($current.items | where id != $id | length)) | upsert observation "clear" | upsert updatedAt (state now))
    state write_provider "downloads" $next
    state release "downloads"
    state publish
    flash $colors.status_error
    return
  }
  let copied = (do { downloads zsh_quote $item.path | ^$pbcopy } | complete)
  if $copied.exit_code != 0 {
    state release "downloads"
    log warning $"pbcopy failed for Download row: ($id)"
    flash $colors.status_error
    return
  }
  let remaining = ($current.items | where id != $id)
  let next = ($current | upsert items $remaining | upsert count ($remaining | length) | upsert observation (if ($remaining | is-empty) {"clear"} else {"attention"}) | upsert updatedAt (state now))
  state write_provider "downloads" $next
  state release "downloads"
  state publish
  flash $colors.status_success
}

def activate_app [id: string] {
  let app = ((apps) | where id == $id)
  if ($app | length) != 1 { log warning $"Rejected unallowlisted social app action: ($id)"; flash $colors.status_error; return }
  let result = (do { ^$open_app -b $app.0.bundleId } | complete)
  if $result.exit_code != 0 { log warning $"Could not activate ($app.0.label)"; flash $colors.status_error }
}

def render [--forced] {
  let data = (aggregate)
  render_rows $data
  if $forced { state reset_popup }
  let popup = (state read_popup)
  if $data.count == 0 and not $popup.pinned { popup_close }
  ^$sketchybar_exe --set $name ...(main_options $data.count)
  # A generation prevents a stale source slide from settling over newer state.
  let previous_count = ($popup.lastCount? | default 0)
  let source_icon = if ($data.downloads | length) > 0 { "" } else if ($data.social | length) > 0 { $data.social.0.icon } else { "" }
  let next_popup = ($popup | upsert lastCount $data.count | upsert animationGeneration (($popup.animationGeneration? | default 0) + 1))
  save_popup $next_popup
  if not $forced and $data.count > 0 and $data.count >= $previous_count {
    ^$sketchybar_exe --animate tanh 18 --set $name icon=$source_icon
    sleep 180ms
    let newest = (state read_popup)
    if ($newest.animationGeneration? | default (-1)) == $next_popup.animationGeneration { ^$sketchybar_exe --set $name ...(main_options $data.count) }
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
        "mouse.exited.global" => { let popup = (set_region "mainHovered" false); if not $popup.pinned { popup_close } }
        "mouse.clicked" => { toggle_pin }
        "forced" => { render --forced }
        "notifications_changed" => { render }
        "display_change" => { render --forced }
        _ => { render }
      }
    }
  }
}
