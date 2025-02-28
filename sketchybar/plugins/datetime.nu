#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

def format_datetime (): datetime -> string {
  $in | format date `%a, %b %d  %H:%M`
}

export const name = "datetime"

export def item () {
  log info $"Rendering ($name)"
  let output = date now | format_datetime
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "datetime.nu"

  (
    sketchybar
      --add item $name right
      --set $name
        padding_right=0
        label=$"($output)"
        label.color=$"($sapphire)"
        label.font.style="Bold Italic"
        label.font.size=16
        icon.drawing=off
        # icon.font.size=26
        icon.color=$"($blue)"
        # icon.padding_left=15
        # label.padding_right=15
        script=$"($nu.current-exe) ($current_path)"
        update_freq=1
  )

  # templates set_item_unit $name $crust $overlay0
}

def main () {
  let d = date now
  let output = $d | format_datetime

  sketchybar --set $name label=$"($output)"
}
