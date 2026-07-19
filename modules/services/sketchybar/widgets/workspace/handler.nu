use std/log
use ../../colors.nu
use providers/aerospace.nu
use providers/rift.nu

const backend = "@backend@"
const aerospace_exe = "@aerospace-exe@"
const rift_cli = "@rift-cli@"
const workspace_selector = '/workspace\..*/'
const listener = "workspaces-listener"
const workspace_focus_animation_duration = 25
const workspace_bar_visible_y_offset = 12
const workspace_bar_hidden_y_offset = 22
const workspace_label_padding = 5
const workspace_bar_padding = 5
const workspace_bar_x_offset = 1

# Keep these constants and the hide/remap/show ordering aligned with the old
# AeroSpace widget: they are visual behavior, not provider logic.
def transparent [color: string] {
  $color | str replace --regex '^0x[0-9a-fA-F]{2}' '0x00'
}

def sketchybar_state_dir [] {
  let state_home = ($env.XDG_STATE_HOME? | default ([$env.HOME ".local" "state"] | path join))
  [$state_home "sketchybar"] | path join
}

def workspace_snapshot_path [] {
  [(sketchybar_state_dir) "workspaces.json"] | path join
}

def workspace_direction_path [] {
  [(sketchybar_state_dir) "workspace-direction"] | path join
}

def workspace_lock_path [] {
  [(sketchybar_state_dir) "workspace-resync.lock"] | path join
}

def item_name [id: string] {
  $"workspace.($id)"
}

def single_workspace_id [workspace: string] {
  let ids = ($workspace | lines | where {|line| ($line | str trim) != "" })
  if ($ids | length) == 1 { $ids.0 } else { null }
}

def required [record: record, field: string] {
  if ($field in ($record | columns)) {
    $record | get $field
  } else {
    error make {msg: $"missing required field ($field)"}
  }
}

def sketchybar_displays [] {
  try { sketchybar --query displays | from json } catch { [] }
}

def aerospace_snapshot [] {
  let focused_raw = (run-external $aerospace_exe "list-workspaces" "--focused")
  let focused = (single_workspace_id $focused_raw)
  if $focused == null { return null }
  let workspaces = (run-external $aerospace_exe "list-workspaces" "--all" "--format" '%{workspace}%{monitor-appkit-nsscreen-screens-id}' "--json" | from json)
  { workspaces: (aerospace normalize $workspaces $focused) }
}

def rift_snapshot [] {
  let displays = (run-external $rift_cli "query" "displays" | from json)
  let active = ($displays | where {|d| ($d.space? | default null) != null})
  let layouts = (
    $active
    | each {|d|
        let space = (required $d space)
        run-external $rift_cli "query" "workspace-layout" "--space-id" ($space | into string)
        | from json
        | each {|workspace| $workspace | merge {space_id: $space} }
      }
    | flatten
  )
  { workspaces: (rift normalize $displays $layouts (sketchybar_displays)) }
}

def workspace_snapshot [] {
  try {
    match $backend {
      "aerospace" => (aerospace_snapshot)
      "rift" => (rift_snapshot)
      _ => { error make {msg: $"unknown workspace provider ($backend)"} }
    }
  } catch {|err|
    log warning $"Could not query workspace state: ($err.msg)"
    null
  }
}

def stable_workspace_snapshot [] {
  let delays = [0ms 150ms 300ms 600ms 1sec]
  mut previous: any = null
  for delay in $delays {
    if $delay > 0sec { sleep $delay }
    let current = (workspace_snapshot)
    if $current == null { $previous = null; continue }
    if $previous != null and $current == $previous { return $current }
    $previous = $current
  }
  null
}

def load_previous_snapshot [] {
  let p = (workspace_snapshot_path)
  if not ($p | path exists) { return null }
  try { open $p } catch { null }
}

def save_workspace_snapshot [snapshot: record] {
  mkdir (sketchybar_state_dir)
  $snapshot | to json | save -f (workspace_snapshot_path)
}

def save_direction [direction: string] {
  mkdir (sketchybar_state_dir)
  $direction | save -f (workspace_direction_path)
}

def load_direction [] {
  try { open (workspace_direction_path) | str trim } catch { "left" }
}

def lock_is_stale [lock_path: string] {
  if not ($lock_path | path exists) { return false }
  try {
    ((^date +%s | into int) - (^/usr/bin/stat -f %m $lock_path | into int)) > 5
  } catch {
    false
  }
}

def acquire_resync_lock [] {
  mkdir (sketchybar_state_dir)
  let lock_path = (workspace_lock_path)
  if (lock_is_stale $lock_path) { rm -rf $lock_path }
  try {
    ^mkdir $lock_path
    true
  } catch {
    false
  }
}

def release_resync_lock [] {
  let lock_path = (workspace_lock_path)
  if ($lock_path | path exists) { rm -rf $lock_path }
}

def hidden_workspace_options [] {
  [
    width=0
    label.color.alpha=0.0
    icon.color.alpha=0.0
    label.padding_left=0
    label.padding_right=0
    icon.padding_left=0
    icon.padding_right=0
    label.background.color.alpha=0.0
    $"label.background.padding_left=($workspace_bar_padding)"
    $"label.background.padding_right=($workspace_bar_padding)"
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_hidden_y_offset)"
  ]
}

def visible_workspace_options [] {
  [
    width=28
    label.color.alpha=1.0
    icon.color.alpha=1.0
    $"label.padding_left=($workspace_label_padding)"
    $"label.padding_right=($workspace_label_padding)"
    icon.padding_left=0
    icon.padding_right=0
    label.background.color.alpha=1.0
    $"label.background.padding_left=($workspace_bar_padding)"
    $"label.background.padding_right=($workspace_bar_padding)"
    $"label.background.x_offset=($workspace_bar_x_offset)"
  ]
}

def workspace_text_options [color: string] {
  [
    label.drawing=on
    icon.drawing=off
    $"label.color=($color)"
    $"icon.color=($color)"
  ]
}

def inactive_workspace_options [hidden: bool] {
  let color = if $hidden { transparent $colors.text_primary } else { $colors.text_primary }
  (workspace_text_options $color) ++ [
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_hidden_y_offset)"
  ]
}

def focused_workspace_options [hidden: bool] {
  let y_offset = if $hidden { $workspace_bar_hidden_y_offset } else { $workspace_bar_visible_y_offset }
  (workspace_text_options $colors.text_primary) ++ [
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($y_offset)"
  ]
}

def focused_workspace_start_options [] {
  focused_workspace_options true
}

def inactive_workspace_label_options [] {
  workspace_text_options $colors.text_primary
}

def workspace_bar_options [y_offset: int] {
  [
    label.background.drawing=on
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($y_offset)"
  ]
}

def hidden_workspace_bar_options [] {
  workspace_bar_options $workspace_bar_hidden_y_offset
}

def visible_workspace_bar_options [] {
  workspace_bar_options $workspace_bar_visible_y_offset
}

def workspace_widget_options [workspace: record] {
  [
    $"associated_display=($workspace.display_id)"
    width=28
    $"label=($workspace.label)"
    label.font.size=14
    label.font.style=Regular
    label.align=center
    label.padding_left=5
    label.padding_right=5
    $"label.color=($colors.text_primary)"
    label.drawing=on
    label.background.drawing=on
    $"label.background.color=($colors.workspace_active)"
    label.background.height=2
    label.background.corner_radius=1
    label.background.padding_left=8
    label.background.padding_right=8
    label.background.x_offset=1
    label.background.y_offset=22
    icon.drawing=off
    $"click_script=__script_path__ click '($workspace.id)'"
  ]
}

def render_items [snapshot: record, direction: string] {
  try { sketchybar --remove $workspace_selector } catch {}
  for workspace in $snapshot.workspaces {
    sketchybar --add item $workspace.item_name $direction
    sketchybar --set $workspace.item_name ...(workspace_widget_options $workspace)
  }
  try { sketchybar --remove workspaces } catch {}
  try { sketchybar --remove $listener } catch {}
  sketchybar --add bracket workspaces $workspace_selector
  sketchybar --set workspaces background.color=0x00000000
  sketchybar --add item $listener $direction
  sketchybar --add event workspace_change
  sketchybar --set $listener script="__script_path__"
  sketchybar --subscribe $listener display_change space_change workspace_change
}

def focused_names [snapshot: record] {
  $snapshot.workspaces | where focused == true | get item_name
}

def topology [snapshot: record] {
  $snapshot.workspaces | sort-by item_name | select item_name display_id label
}

def animate_hide_workspaces [] {
  sketchybar --animate tanh 30 --set $workspace_selector ...(hidden_workspace_options)
}

def reset_hidden_workspaces [] {
  sketchybar --set $workspace_selector ...(hidden_workspace_options)
}

def animate_show_workspaces [] {
  sketchybar --animate tanh 30 --set $workspace_selector ...(visible_workspace_options)
}
def set_focused_workspace [workspace_name: string, hidden: bool] {
  if $hidden {
    sketchybar --set $workspace_name ...(focused_workspace_options true)
  } else {
    sketchybar --set $workspace_name ...(focused_workspace_start_options)
    sketchybar --animate tanh $workspace_focus_animation_duration --set $workspace_name ...(visible_workspace_bar_options)
  }
}

def animate_focus_transition [focused: list<string>, previous: list<string>] {
  let inactive = ($previous | where {|name| not ($name in $focused) })

  # Boolean/text setup is immediate and must precede the animated properties.
  for p in $inactive { sketchybar --set $p ...(inactive_workspace_label_options) }
  for f in $focused { sketchybar --set $f ...(focused_workspace_start_options) }

  # Submit both halves as one SketchyBar animation transaction. This keeps the
  # source and destination on the same timeline and leaves no gap in which a
  # concurrent workspace event can overwrite only the source transition.
  mut args = ["--animate" "tanh" ($workspace_focus_animation_duration | into string)]
  for p in $inactive { $args = ($args ++ ["--set" $p] ++ (hidden_workspace_bar_options)) }
  for f in $focused { $args = ($args ++ ["--set" $f] ++ (visible_workspace_bar_options)) }
  if ($args | length) > 3 { run-external sketchybar ...$args }
}

def update_focus [focused: list<string>, previous: list<string>, --reset-all, --hidden] {
  if $reset_all {
    sketchybar --set $workspace_selector ...(inactive_workspace_options $hidden)
    for f in $focused { set_focused_workspace $f $hidden }
  } else if $hidden {
    for f in $focused { set_focused_workspace $f true }
  } else {
    animate_focus_transition $focused $previous
  }
}

def resync_workspaces [--animate, --update-focus] {
  if $animate and not (acquire_resync_lock) {
    log info "Skipping workspace resync because another resync is running"
    return
  }

  let snapshot = (stable_workspace_snapshot)
  if $snapshot == null {
    log warning "Skipping workspace resync because provider state did not stabilize"
    if $animate { release_resync_lock }
    return
  }
  let previous = (load_previous_snapshot)
  let direction = (load_direction)
  let topology_changed = ($previous == null or (topology $previous) != (topology $snapshot))
  let should_animate = ($animate and $previous != null and $topology_changed)

  if $should_animate {
    animate_hide_workspaces
    sleep 800ms
  }
  if $topology_changed { render_items $snapshot $direction }
  if $should_animate {
    update_focus (focused_names $snapshot) [] --reset-all --hidden
  } else if $topology_changed {
    update_focus (focused_names $snapshot) [] --reset-all
  } else if $update_focus {
    update_focus (focused_names $snapshot) (focused_names $previous)
  }
  if $topology_changed or $update_focus { save_workspace_snapshot $snapshot }
  if $should_animate {
    reset_hidden_workspaces
    animate_show_workspaces
    sleep 350ms
    update_focus (focused_names $snapshot) [] --reset-all
  }
  if $animate { release_resync_lock }
}

def handle_workspace_change [] {
  if $backend == "aerospace" {
    let focused = (single_workspace_id ($env.FOCUSED_WORKSPACE? | default ""))
    if $focused == null { resync_workspaces; return }
    let previous = (single_workspace_id ($env.PREV_WORKSPACE? | default ""))
    let focused_name = (item_name $focused)
    let previous_names = if $previous == null { [] } else { [(item_name $previous)] }
    update_focus [$focused_name] $previous_names

    # Keep the snapshot's focus state current so the following built-in
    # space_change event cannot replay and replace this animation.
    let snapshot = (load_previous_snapshot)
    if $snapshot != null and $focused_name in ($snapshot.workspaces | get item_name) {
      let workspaces = ($snapshot.workspaces | each {|ws|
        $ws | upsert focused ($ws.item_name == $focused_name)
      })
      save_workspace_snapshot ($snapshot | upsert workspaces $workspaces)
    }
  } else { resync_workspaces --update-focus }
}

def click_workspace [id: string] {
  let snapshot = (load_previous_snapshot)
  if $snapshot == null { return }
  let ws = ($snapshot.workspaces | where id == $id | first)
  match $ws.switch_target.provider {
    "aerospace" => { run-external $aerospace_exe "workspace" $ws.switch_target.workspace | ignore }
    "rift" => { run-external $rift_cli "execute" "display" "focus" "--uuid" $ws.switch_target.display_uuid | ignore; run-external $rift_cli "execute" "workspace" "switch" ($ws.switch_target.workspace_index | into string) | ignore }
  }
}

def main [action?: string, arg?: string] {
  match ($action | default "event") {
    "render" => {
      save_direction $arg
      let snapshot = (stable_workspace_snapshot)
      if $snapshot != null {
        render_items $snapshot $arg
        update_focus (focused_names $snapshot) [] --reset-all
        save_workspace_snapshot $snapshot
      }
    }
    "click" => { click_workspace $arg }
    _ => {
      match $env.SENDER {
        "workspace_change" => { handle_workspace_change }
        "display_change" => { resync_workspaces --animate }
        "space_change" => { resync_workspaces --animate }
        "forced" => { resync_workspaces }
        _ => {}
      }
    }
  }
}
