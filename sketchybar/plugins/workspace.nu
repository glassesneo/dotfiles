#!/usr/bin/env nu
use std/log
use ../colors.nu

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
          label=$"($space_id)"
          label.color=$"($overlay0)"
          label.padding_left=2
          label.padding_right=2
          label.highlight=off
          label.highlight_color=$"($sapphire)"
          label.background.height=22
          label.background.corner_radius=4
          label.background.padding_left=10
          label.background.padding_right=10
          # label.background.drawing=off
          # label.background.color=$"($overlay2)"
          click_script=$"aerospace workspace ($space_id)"
          script=$"($nu.current-exe) ($current_path) ($space_id)"
        --subscribe $space aerospace_workspace_change
    )
  }
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
      # label.background.drawing=$"($state)"
  )
}
