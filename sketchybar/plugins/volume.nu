#!/usr/bin/env nu
use std/log
use ../colors.nu

export const name = "volume"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "calendar.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name volume_change
  )
}

def main () {
  # if $env.SENDER != "volume_change" {
  #   return
  # }
  let volume: int = $env.INFO | into int
  let icon: string = match $volume {
    61..100 => "󰕾",
    31..60 => "󰖀",
    1..30 => "󰕿",
    _ => "󰖁"
  }

  (
    sketchybar --set $name
      icon=$"($icon)"
      volume=$"($volume)%"
  )
}
