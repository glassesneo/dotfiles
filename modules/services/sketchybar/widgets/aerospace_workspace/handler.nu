use std/log
use ../../colors.nu

const workspace_selector = '/workspace\..*/'
const workspace_focus_animation_duration = 25
const workspace_bar_visible_y_offset = 12
const workspace_bar_hidden_y_offset = 22
const workspace_label_padding = 5
const workspace_bar_padding = 5
const workspace_bar_x_offset = 1

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

def workspace_lock_path [] {
  [(sketchybar_state_dir) "workspace-resync.lock"] | path join
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

def single_workspace_id [workspace: string] {
  let ids = ($workspace | lines | where {|line| ($line | str trim) != "" })

  if ($ids | length) == 1 {
    $ids.0
  } else {
    null
  }
}

def inactive_workspace_options [hidden: bool] {
  let normal_color = if $hidden { transparent $colors.text_primary } else { $colors.text_primary }

  [
    label.drawing=on
    icon.drawing=off
    $"label.color=($normal_color)"
    $"icon.color=($normal_color)"
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_hidden_y_offset)"
  ]
}

def focused_workspace_start_options [] {
  [
    label.drawing=on
    icon.drawing=off
    $"label.color=($colors.text_primary)"
    $"icon.color=($colors.text_primary)"
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_hidden_y_offset)"
  ]
}

def inactive_workspace_label_options [] {
  [
    label.drawing=on
    icon.drawing=off
    $"label.color=($colors.text_primary)"
    $"icon.color=($colors.text_primary)"
  ]
}

def focused_workspace_options [hidden: bool] {
  let focused_bar_y_offset = if $hidden { $workspace_bar_hidden_y_offset } else { $workspace_bar_visible_y_offset }

  [
    label.drawing=on
    icon.drawing=off
    $"label.color=($colors.text_primary)"
    $"icon.color=($colors.text_primary)"
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($focused_bar_y_offset)"
  ]
}

def hidden_workspace_bar_options [] {
  [
    label.background.drawing=on
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_hidden_y_offset)"
  ]
}

def visible_workspace_bar_options [] {
  [
    label.background.drawing=on
    $"label.background.x_offset=($workspace_bar_x_offset)"
    $"label.background.y_offset=($workspace_bar_visible_y_offset)"
  ]
}

def set_focused_workspace [workspace: string, hidden: bool] {
  if $hidden {
    sketchybar --set $"workspace.($workspace)" ...(focused_workspace_options true)
  } else {
    sketchybar --set $"workspace.($workspace)" ...(focused_workspace_start_options)
    sketchybar --animate tanh $workspace_focus_animation_duration --set $"workspace.($workspace)" ...(visible_workspace_bar_options)
  }
}

def animate_inactive_workspace [workspace: string] {
  sketchybar --set $"workspace.($workspace)" ...(inactive_workspace_label_options)
  sketchybar --animate tanh $workspace_focus_animation_duration --set $"workspace.($workspace)" ...(hidden_workspace_bar_options)
}

def update_focus [focused_workspace: string, previous_workspace?: string, --reset-all, --hidden] {
  log info $"($previous_workspace) -> ($focused_workspace)"

  if $reset_all {
    sketchybar --set $workspace_selector ...(inactive_workspace_options $hidden)
  } else if $previous_workspace != null and $previous_workspace != $focused_workspace {
    animate_inactive_workspace $previous_workspace
  }

  set_focused_workspace $focused_workspace $hidden
}

def update_display (workspaces: table<monitor-appkit-nsscreen-screens-id: int, workspace: string>) {
  for workspace in $workspaces {
    let workspace_id = (single_workspace_id $workspace.workspace)
    if $workspace_id == null {
      log warning $"Skipping display update for unstable workspace id: ($workspace.workspace)"
      continue
    }

    let workspace_name = $"workspace.($workspace_id)"
    let monitor_id: int = $workspace.monitor-appkit-nsscreen-screens-id

    let workspace_widget_options = [
      $"associated_display=($monitor_id)"
    ]

    sketchybar --set $workspace_name ...$workspace_widget_options
  }
}

def workspace_snapshot [] {
  try {
    let focused_raw: string = aerospace list-workspaces --focused
    let focused_workspace = (single_workspace_id $focused_raw)

    if $focused_workspace == null {
      log warning $"Skipping unstable focused workspace: ($focused_raw)"
      null
    } else {
      let workspaces: table<monitor-appkit-nsscreen-screens-id: int, workspace: string> = aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json | from json
      {
        focused: $focused_workspace
        workspaces: $workspaces
      }
    }
  } catch {
    log warning "Could not query AeroSpace workspace state"
    null
  }
}

def stable_workspace_snapshot [] {
  let delays = [0ms 150ms 300ms 600ms 1sec]
  mut previous: any = null
  mut stable: any = null

  for delay in $delays {
    if $delay > 0sec {
      sleep $delay
    }

    let current = (workspace_snapshot)
    if $current == null {
      $previous = null
      continue
    }

    if $previous != null {
      if $current == $previous {
        $stable = $current
        break
      }
    }

    $previous = $current
  }

  $stable
}

def workspace_mapping [snapshot: record] {
  $snapshot.workspaces | sort-by workspace | select workspace monitor-appkit-nsscreen-screens-id
}

def load_previous_snapshot [] {
  let snapshot_path = (workspace_snapshot_path)
  if not ($snapshot_path | path exists) {
    return null
  }

  try {
    open $snapshot_path
  } catch {
    log warning $"Could not read previous workspace snapshot: ($snapshot_path)"
    null
  }
}

def save_workspace_snapshot [snapshot: record] {
  let state_dir = (sketchybar_state_dir)
  mkdir $state_dir
  $snapshot | to json | save -f (workspace_snapshot_path)
}

def lock_is_stale [lock_path: string] {
  if not ($lock_path | path exists) {
    return false
  }

  try {
    let now = (^date +%s | into int)
    let lock_mtime = if ("/usr/bin/stat" | path exists) {
      ^/usr/bin/stat -f %m $lock_path | into int
    } else {
      ^stat -c %Y $lock_path | into int
    }
    (($now - $lock_mtime) > 5)
  } catch {
    false
  }
}

def acquire_resync_lock [] {
  let state_dir = (sketchybar_state_dir)
  mkdir $state_dir

  let lock_path = (workspace_lock_path)
  if (lock_is_stale $lock_path) {
    log warning "Removing stale workspace resync lock"
    rm -rf $lock_path
  }

  try {
    ^mkdir $lock_path
    true
  } catch {
    false
  }
}

def release_resync_lock [] {
  let lock_path = (workspace_lock_path)
  if ($lock_path | path exists) {
    rm -rf $lock_path
  }
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

def resync_workspaces [--animate] {
  if $animate {
    if not (acquire_resync_lock) {
      log info "Skipping workspace resync because another resync is running"
      return
    }
  }

  let snapshot = (stable_workspace_snapshot)
  if $snapshot == null {
    log warning "Skipping workspace resync because AeroSpace state did not stabilize"
    if $animate {
      release_resync_lock
    }
    return
  }

  let previous_snapshot = (load_previous_snapshot)
  let should_animate = (
    $animate
    and $previous_snapshot != null
    and (workspace_mapping $previous_snapshot) != (workspace_mapping $snapshot)
  )

  if $should_animate {
    animate_hide_workspaces
    sleep 800ms
  }

  if $should_animate {
    update_focus $snapshot.focused --reset-all --hidden
  } else {
    update_focus $snapshot.focused --reset-all
  }

  update_display $snapshot.workspaces
  save_workspace_snapshot $snapshot

  if $should_animate {
    reset_hidden_workspaces
    animate_show_workspaces
    sleep 350ms
    update_focus $snapshot.focused --reset-all
  }

  if $animate {
    release_resync_lock
  }
}

def handle_workspace_change [] {
  let focused_workspace = (single_workspace_id ($env.FOCUSED_WORKSPACE? | default ""))
  if $focused_workspace == null {
    log warning $"Skipping unstable focused workspace from event: ($env.FOCUSED_WORKSPACE? | default "")"
    return
  }

  let previous_workspace = (single_workspace_id ($env.PREV_WORKSPACE? | default ""))
  if $previous_workspace == null {
    update_focus $focused_workspace
  } else {
    update_focus $focused_workspace $previous_workspace
  }
}

def main () {
  match $env.SENDER {
    "aerospace_workspace_change" => {
      handle_workspace_change
    }
    "display_change" => {
      resync_workspaces --animate
    }
    "space_change" => {
      resync_workspaces --animate
    }
    # When `sketchybar` --update is triggered
    "forced" => {
      resync_workspaces
    }
  }
}
