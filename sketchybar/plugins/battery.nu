#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "battery"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name right
      --set $name
        icon.font.style=Regular
        icon.font.size=16
        icon.padding_right=5
        label.font.style=Bold
        label.font.size=19
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120
      --subscribe $name system_woke power_source_change
  )

  # utils set_item_unit $name $crust $overlay0
}

def main () {
  let percentage = pmset -g batt
    | lines
    | find '%;'
    | parse ' {top} (id={id}){batt}%; {rest}'
    | get batt
    | get 0
    | into int

  if (pmset -g batt | lines | find "AC Power" | length) != 0 {
    (
      sketchybar
        --set $name
          label=""
          label.color=$"($peach)"
          icon=$"($percentage)%"
    )
    return
  }
  let icon: record<kind: string, color: string> = match $percentage {
    91..100 => {kind: "", color: $"($teal)"}
    61..90 => {kind: "", color: $"($green)"}
    31..60 => {kind: "", color: $"($yellow)"}
    11..30 => {kind: "", color: $"($peach)"}
    _ => {kind: "", color: $"($red)"}
  }

  (
    sketchybar --set $name
      label=$"($icon.kind)"
      label.color=$"($icon.color)"
      icon=$"($percentage)%"
  )
}
