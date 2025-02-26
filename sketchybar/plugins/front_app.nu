#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "front_app"

def icon_color (): string -> string {
  match $in {
    "Arc" => $pink
    "Ghostty" => $blue
    "Obsidian" => $mauve
    "Kitty" => $flamingo
    _ => $text
  }
}

export def item () {
  log info $"Rendering ($name)"
  let current_path: string = $env.FILE_PWD | path join "plugins/" | path join "front_app.nu"

  (
    sketchybar
      --add item $name left
      --set $name
        padding_left=30
        # background.clip=1.0
        display=active
        label.font.style=Bold
        icon.font="sketchybar-app-font:Regular:20.0"
        icon.padding_right="2"
        background.border_color=$"($text)"
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name front_app_switched
  )

  # templates set_item_unit_without_border $name "0x00000000"
}

def main () {
  if $env.SENDER != "front_app_switched" {
    return
  }

  let content = cat ~/.config/sketchybar_icon_map.sh
  let icon = bash -c $"($content)" -- $env.INFO

  (
    sketchybar --set $name
      label=$"($env.INFO)"
      icon=$"($icon)"
      icon.color=$"($env.INFO | icon_color)"
  )
}

