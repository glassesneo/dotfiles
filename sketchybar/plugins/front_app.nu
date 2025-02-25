#!/usr/bin/env nu
use std/log
use ../colors.nu

export const name = "front_app"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "front_app.nu"

  (
    sketchybar
      --add item $name left
      --set $name
        icon.font="sketchybar-app-font:Regular:20.0"
        icon.padding_left=16
        icon.padding_right=4
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name front_app_switched
  )
}

def main () {
  if $env.SENDER != "front_app_switched" {
    return
  }

  let content = cat ~/.config/sketchybar_icon_map.sh
  let icon = bash -c $"($content)" -- $env.INFO
  # let icon = bash -c $"($content)" -- "Ghostty"

  (
    sketchybar --set $name
      label=$"($env.INFO)"
      icon=$"($icon)"
  )
}

