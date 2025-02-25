#!/usr/bin/env nu
use std/log
use ../colors.nu

export module calendar {
  export const name = "calendar"

  def format_calendar []: datetime -> string {
    $in | format date `%Y-%m-%d (%a)`
  }

  def format_clock []: datetime -> string {
    $in | format date `%H:%M`
  }

  export def item () {
    log info $"Rendering ($name)"
    let output = date now | format_calendar
    let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "datetime.nu"


    (
      sketchybar
        --add item $name right
        --set $name
          icon=""
          # icon.color=$"($base)"
          padding_left=8
          padding_right=8
          # icon.background.color=$"($rosewater)"
          label=$"($output)"
          # label.color=$"($rosewater)"
          script=$"($nu.current-exe) ($current_path)" update_freq=1
    )
  }
}

def main () {
  let d = date now
  let calendar_output = $d | format_calendar

  sketchybar --set calendar label=$"($calendar_output)"
}
