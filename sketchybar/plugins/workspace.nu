#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "workspace"

def create_workspace (space_id: string, display: int) {
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "workspace.nu"
  let space = $"($name).($space_id)"
  (
    sketchybar
      --add item $space left
      --set $space
        display=$"($display)"
        padding_left=0
        padding_right=0
        label=$"($space_id)"
        label.color=$"($text)"
        label.font.size=17
        label.padding_left=10
        label.padding_right=10
        label.highlight=off
        label.highlight_color=$"($red)"
        icon.drawing=off
        click_script=$"aerospace workspace ($space_id)"
        script=$"($nu.current-exe) ($current_path) ($space_id)"
      --subscribe $space aerospace_workspace_change
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

  aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json
  | from json
  | each {|space|
    create_workspace $space.workspace $space.monitor-appkit-nsscreen-screens-id
  }

  (
    sketchybar
      --add bracket workspaces '/workspace\..*/'
      --set workspaces
        background.color=$"($surface0)"
        background.corner_radius=8
        background.height=28
        script=$"($nu.current-exe) ($current_path) update-display"
      --subscribe workspaces display_change

  )
}

def main [space_id: string] {
  match $env.SENDER {
    "aerospace_workspace_change" => {
      let state = if $space_id == ($env.FOCUSED_WORKSPACE? | default "") {
        "on"
      } else {
        "off"
      }

      (
        sketchybar --set $env.NAME
          label.highlight=$"($state)"
      )
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
