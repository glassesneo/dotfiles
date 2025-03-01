#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "volume"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add alias "Control Center,Sound" right
      --rename "Control Center,Sound" $name
      --set $name
        label.drawing=off
        alias.color=$"($text)"
        alias.scale=1.1
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name volume_change
  )
}

def main () {
  if $env.SENDER != "volume_change" {
    return
  }
  
  let volume = $env.INFO | into int
  let color = if $volume == 0 {
    $red
  } else {
    $text
  }

  (
    sketchybar
      --set $name
        alias.color=$"($color)"
  )

}
