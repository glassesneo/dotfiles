#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "workspace"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "workspace.nu"

  sketchybar --add event aerospace_workspace_change

  aerospace list-workspaces --all
  | lines
  | each {|space_id|
    let space = $"($name).($space_id)"

    (
      sketchybar
        --add item $space left
        --set $space
          padding_left=0
          padding_right=0
          label=$"($space_id)"
          label.color=$"($text)"
          label.font.size=16
          label.padding_left=14
          label.padding_right=14
          label.highlight=off
          label.highlight_color=$"($red)"
          icon.drawing=off
          click_script=$"aerospace workspace ($space_id)"
          script=$"($nu.current-exe) ($current_path) ($space_id)"
        --subscribe $space aerospace_workspace_change
    )
  }

  (
    sketchybar
      --add bracket workspaces '/workspace\..*/'
      --set workspaces
        background.color=$"($surface0)"
        background.corner_radius=8
        background.height=28
  )
}

export def trigger () {
  bash -c $"(which sketchybar | get path | get 0) --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE"
}

def main [space_id: string] {
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
