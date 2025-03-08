#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

def format_datetime (): datetime -> string {
  $in | format date `%a, %b %d  %H:%M`
}

export const name = "datetime"

export def item () {
  log info $"Rendering ($name)"
  let output = date now | format_datetime
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name right
      --set $name
        padding_right=0
        label=$"($output)"
        label.color=$"($sky)"
        label.font.style="Bold Italic"
        label.font.size=16
        label.padding_right=0
        icon.drawing=off
        script=$"($nu.current-exe) ($current_path)"
        update_freq=1
  )
}

def main () {
  let d = date now
  let output = $d | format_datetime

  sketchybar --set $name label=$"($output)"
}
