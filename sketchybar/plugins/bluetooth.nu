#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "bluetooth"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add alias "Control Center,Bluetooth" right
      --rename "Control Center,Bluetooth" $name
      --set $name
  )

  utils set_item_unit $name $crust $overlay0
}

