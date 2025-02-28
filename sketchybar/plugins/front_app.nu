#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "front_app"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "front_app.nu"

  (
    sketchybar
      --add item $name left
      --set $name
        padding_left=10
        # background.clip=1.0
        display=active
        label.font.style=Bold
        label.font.size=18
        icon.font="sketchybar-app-font:Regular:20.0"
        icon.padding_right=2
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name front_app_switched
  )

  # templates set_item_unit_without_border $name "0x00000000"
}

def main () {
  if $env.SENDER != "front_app_switched" {
    return
  }

  let content = cat ~/.config/sketchybar_icon_map.sh
  let icon = bash -c $"($content)" -- $env.INFO

  # (
  #   sketchybar
  #     --animate tanh 15
  #     --set $name
  # )
  (
    sketchybar
      --set $name
        icon=$"($icon)"
        label=$"($env.INFO)"
        icon.color=$"($env.INFO | templates icon_color)"
  )
  (
    sketchybar
      --animate tanh 20
      --set $name
        icon.y_offset=7
        icon.y_offset=0
  )
}

