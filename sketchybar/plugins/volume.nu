#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "volume"

export def item () {
  log info $"Rendering ($name)"

  (
    sketchybar
      --add alias "Control Center,Sound" right
      --rename "Control Center,Sound" $name
      --set $name
        label.drawing=off
  )
}
