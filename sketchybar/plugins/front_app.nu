#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../templates.nu

export const name = "front_app"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | templates get_current_path

  (
    sketchybar
      --add item $name left
      --set $name
        padding_left=10
        # background.clip=1.0
        display=active
        label.font.style=Bold
        label.font.size=18
        icon.font="sketchybar-app-font:Regular:20.0"
        icon.padding_right=2
        popup.background.border_width=2
        popup.background.border_color=$text
        popup.background.corner_radius=5
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name
        front_app_switched
        mouse.entered
        mouse.exited
  )

  # templates set_item_unit_without_border $name "0x00000000"
}

def switch_front_app (app_name: string) {
  let content = cat ~/.config/sketchybar_icon_map.sh
  let icon = bash -c $"($content)" -- $app_name

  (
    sketchybar
      --set $name
        icon=$"($icon)"
        label=$"($env.INFO)"
        icon.color=$"($env.INFO | templates icon_color)"
  )
  (
    sketchybar
      --animate tanh 20
      --set $name
        icon.y_offset=7
        icon.y_offset=0
  )
}

def display_popup () {
  (
    sketchybar
      --set $name
        popup.drawing=on
  )
}

def main () {
  match $env.SENDER {
    "front_app_switched" => {
      switch_front_app $env.INFO
    }
  }
}

