#!/usr/bin/env nu
use std/log
use ../colors.nu

export const name = "battery"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "battery.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        # icon.color=$"($sky)"
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120
      --subscribe $name system_woke power_source_change
  )
}

def main () {
  let percentage = pmset -g batt
    | lines
    | find '%;'
    | parse ' {top} (id={id}){batt}%; {rest}'
    | get batt
    | get 0
    | into int

  let icon: string = if (pmset -g batt | lines | find 'AC Power' | length) == 0 {
    match $percentage {
      91..100 => ""
      61..90 => ""
      31..60 => ""
      11..30 => ""
      _ => ""
    }
  } else { "" }

  (
    sketchybar --set $name
      icon=$"($icon)"
      label=$"($percentage)%"
  )
}
