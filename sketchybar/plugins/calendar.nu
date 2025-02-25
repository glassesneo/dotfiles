#!/usr/bin/env nu
use std/log
use ../colors.nu

export const name = "calendar"

def format_calendar []: datetime -> string {
  $in | format date "%H:%M | %a %d %b"
}

export def item () {
  log info $"Rendering ($name)"
  let output = date now | format_calendar
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "calendar.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        label=$"($output)"
        label.color=$"($rosewater)"
        script=$"($nu.current-exe) ($current_path)" update_freq=1
  )
}

def main () {
  let d = date now
  let calendar_output = $d | format_calendar

  sketchybar --set $name label=$"($calendar_output)"
}
