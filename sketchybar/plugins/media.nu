#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "media"

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "media.nu"

  (
    sketchybar
      --add item $name center
      --set $name
        label="-"
        label.padding_left=12
        label.padding_right=12
        label.color=$"($text)"
        label.font.family="HackGen Console NF"
        label.font.size=15
        label.font.style=Bold
        label.max_chars=30
        label.scroll_duration=180
        scroll_texts=on
        icon=""
        icon.color=$"($text)"
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120
      --subscribe $name media_change
  )

  # templates set_item_unit_without_border $name "0x00000000"
  templates set_item_unit $name $crust $overlay0
}

def main () {
  let info = $env.INFO | from json
  let state = $info | get state
  if $state == "playing" {
    (
      sketchybar
        --animate tanh 30
        --set $name
          label=$"($info | get title) - ($info | get artist)"
          icon.color=$"($red)"
    )
  } else {
    (
      sketchybar
        --animate tanh 30
        --set $name
          label="──"
          icon.color=$"($text)"
    )
  }
}
