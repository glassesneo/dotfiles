#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "workspace"
const position = "@workspace_position@"

def create_workspace (space_id: string, display: int) {
  let current_path = $name | utils get_current_path
  let space = $"($name).($space_id)"
  (
    sketchybar
      --add item $space $position
      --set $space
        display=$"($display)"
        padding_left=2
        padding_right=2
        label=$"($space_id)"
        label.color=$"($colors.text_primary)"
        label.font.size=14
        label.font.style="Regular"
        label.padding_left=8
        label.padding_right=8
        label.drawing=on
        icon="•"
        icon.color=$"($colors.workspace_active)"
        icon.font.size=15
        icon.padding_left=8
        icon.padding_right=8
        icon.drawing=off
        click_script=$"aerospace workspace ($space_id)"
        script=$"($nu.current-exe) ($current_path) ($space_id)"
      --subscribe $space aerospace_workspace_change
  )
}

def set_focus_style (space_id: string, focused: bool) {
  let space = $"($name).($space_id)"
  (
    sketchybar
      --set $space
        label=$"($space_id)"
        label.drawing=$"(not $focused)"
        label.font.style="Regular"
        icon.drawing=$"($focused)"
  )
}

def set_workspace_display (space_id: string, display: int) {
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "workspace.nu"
  let space = $"($name).($space_id)"
  (
    sketchybar
      --set $space
        display=$"($display)"
  )
}

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "workspace.nu"

  sketchybar --add event aerospace_workspace_change

  let spaces = aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json
  | from json

  $spaces | each {|space|
    create_workspace $space.workspace $space.monitor-appkit-nsscreen-screens-id
  }

  # Reorder workspace items to fix q-region right-to-left stacking
  let space_names = $spaces | each {|s| $"($name).($s.workspace)"}
  let ordered = if $position == "q" { $space_names | reverse } else { $space_names }
  sketchybar --reorder ...($ordered)

  # Bracket kept for display_change subscription; visual styling owned by layout islands
  (
    sketchybar
      --add bracket workspaces '/workspace\..*/'
      --set workspaces
        background.color="0x00000000"
        script=$"($nu.current-exe) ($current_path) update-display"
      --subscribe workspaces display_change

  )

  let focused_workspace = aerospace list-workspaces --focused --format '%{workspace}' --json
  | from json
  | get 0.workspace
  set_focus_style $focused_workspace true
}

def toggle_highlight (space_id: string) {
  let state = $space_id == ($env.FOCUSED_WORKSPACE? | default "")
  set_focus_style $space_id $state
}

def main [space_id: string] {
  match $env.SENDER {
    "aerospace_workspace_change" => {
      toggle_highlight $space_id
    }
    _ => {}
  }
}

def 'main update-display' [] {
  if $env.SENDER != "display_change" {
    return
  }
  aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json
  | from json
  | each {|space|
    set_workspace_display $space.workspace $space.monitor-appkit-nsscreen-screens-id
  }
}
