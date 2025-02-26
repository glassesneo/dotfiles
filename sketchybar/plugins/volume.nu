#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "volume"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "volume.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        # icon.padding_left=10
        # label.padding_right=10
        script=$"($nu.current-exe) ($current_path)"
        background.border_color=$"($text)"
      --subscribe $name volume_change
  )

  templates set_item_unit $name $crust $overlay0
}

def main () {
  if $env.SENDER != "volume_change" {
    return
  }
  let volume: int = $env.INFO | into int
  let icon: string = match $volume {
    61..100 => {kind: "󰕾", color: $text},
    31..60 => {kind: "󰖀", color: $text},
    1..30 => {kind: "󰕿", color: $text},
    _ => {kind: "󰖁", color: $red}
  }

  (
    sketchybar --set $name
      icon=$"($icon.kind)"
      icon.color=$"($icon.color)"
      label=$"($volume)%"
  )
}
