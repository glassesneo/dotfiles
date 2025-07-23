#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "apple_logo"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name left
      --set $name
        padding_left=0
        padding_right=20
        label.drawing=off
        icon=""
        icon.font="Hack Nerd Font:Regular:22"
        icon.padding_left=6
        icon.padding_right=6
        background.color=$"($colors.mantle)"
        background.corner_radius=8
        background.height=28
        background.border_width=1
        background.border_color=$"($colors.lavender)"
  )

}

def main () {}
