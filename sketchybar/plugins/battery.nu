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
        icon.padding_left=12
        label.padding_right=12
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120

      --subscribe $name system_woke power_source_change
  )

  templates set_item_unit $name $crust $overlay0
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

  (
    sketchybar --set $name
      icon=$"($icon.kind)"
      icon.color=$"($icon.color)"
      label=$"($percentage)%"
  )
}
