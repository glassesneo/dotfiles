#!/usr/bin/env nu
use std/log
use ../colors.nu

def format_clock (): datetime -> string {
  $in | format date `%H:%M`
}

def format_calendar (): datetime -> string {
  $in | format date `%Y-%m-%d (%a)`
}

def map-to-icon (): string -> string {
    let index = $in | into int
    [            ] | get $index
}

export module clock {
  export const name = "clock"

  export def item () {
    log info $"Rendering ($name)"
    let output = date now | format_clock
    let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "datetime.nu"

    (
      sketchybar
        --add item $name right
        --set $name
          padding_left=4
          padding_right=0
          label=$"($output)"
          label.color=$"($lavender)"
          label.padding_right=0
          icon.font.size=20
          icon.color=$"($blue)"
          icon.padding_right=0
          script=$"($nu.current-exe) ($current_path)"
          update_freq=1
    )
  }
}

export module calendar {
  export const name = "calendar"

  export def item () {
    log info $"Rendering ($name)"
    let output = date now | format_calendar
    let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "datetime.nu"

    (
      sketchybar
        --add item $name right
        --set $name
          icon=""
          icon.color=$"($peach)"
          label=$"($output)"
          label.color=$"($yellow)"
          # script=$"($nu.current-exe) ($current_path)"
          # update_freq=1
    )
  }
}

def main () {
  let d = date now
  let clock_output = $d | format_clock
  let clock_icon = $d | format date "%-I" | map-to-icon
  let calendar_output = $d | format_calendar

  sketchybar --set clock label=$"($clock_output)" icon=$"($clock_icon)"
  sketchybar --set calendar label=$"($calendar_output)"
}
