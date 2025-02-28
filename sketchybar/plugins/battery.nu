#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "battery"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "battery.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        icon.font.style=Regular
        icon.font.size=16
        label.font.style=Bold
        label.font.size=19
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120
      --subscribe $name system_woke power_source_change
  )

  # templates set_item_unit $name $crust $overlay0
}

def main () {
  let percentage = pmset -g batt
    | lines
    | find '%;'
    | parse ' {top} (id={id}){batt}%; {rest}'
    | get batt
    | get 0
    | into int

  let icon: record<kind: string, color: string> = if (pmset -g batt | lines | find 'AC Power' | length) != 0 {
    {
      kind: "",
      color: $"($peach)"
    }
  } else {
     match $percentage {
      91..100 => {kind: "", color: $"($teal)"}
      61..90 => {kind: "", color: $"($green)"}
      31..60 => {kind: "", color: $"($yellow)"}
      11..30 => {kind: "", color: $"($peach)"}
      _ => {kind: "", color: $"($red)"}
    }
  }

  # (
  #   sketchybar
  #     --animate tanh 20
  #     --set $name label.y_offset=5
  # )

  (
    sketchybar --set $name
      label=$"($icon.kind)"
      label.color=$"($icon.color)"
      icon=$"($percentage)%"
  )

  (
    sketchybar
      --animate tanh 20
      --set $name
        label.y_offset=7
        label.y_offset=0
  )

}
