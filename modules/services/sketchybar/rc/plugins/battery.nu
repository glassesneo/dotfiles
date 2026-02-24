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

  # utils set_item_unit $name $surface_background $popup_border
}

def main () {
  let percentage = pmset -g batt
    | lines
    | find '%;'
    | split words
    | get 0
    | get 5
    | into int

  if (pmset -g batt | lines | find "AC Power" | length) != 0 {
    (
      sketchybar
        --set $name
          label=""
          label.color=$"($colors.status_charging)"
          icon=$"($percentage)%"
    )
    return
  }
  let icon: record<kind: string, color: string> = match $percentage {
    91..100 => {kind: $"\u{f240}", color: $"($colors.status_success)"}
    61..90 => {kind: $"\u{f241}", color: $"($colors.status_success)"}
    31..60 => {kind: $"\u{f242}", color: $"($colors.status_warning)"}
    11..30 => {kind: $"\u{f243}", color: $"($colors.status_caution)"}
    _ => {kind: $"\u{f244}", color: $"($colors.status_error)"}
  }

  (
    sketchybar --set $name
      label=$"($icon.kind)"
      label.color=$"($icon.color)"
      icon=$"($percentage)%"
  )
}
