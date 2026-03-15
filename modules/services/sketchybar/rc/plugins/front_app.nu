#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "front_app"
const position = "@front_app_position@"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
        sketchybar
      --add item $name $position
      --set $name
        padding_left=10
        padding_right=8
        display=active
        label.font.style=Bold
        label.font.size=14
        label.padding_right=0
        icon.font="sketchybar-app-font:Regular:16.0"
        icon.padding_right=2
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name
        front_app_switched
  )
}

def get_icon (): string -> string {
  let content = cat ~/.config/sketchybar_icon_map.sh
  return (bash -c $content -- $in)
}

def switch_front_app (app_name: string) {
  let icon = match $app_name {
    "kitty-quick-access" => {"kitty" | get_icon},
    _ => {$app_name | get_icon}
  }
  (
    sketchybar
      --set $name
        icon=$"($icon)"
        label=$"($app_name)"
        icon.color=$"($app_name | utils icon_color)"
  )
  # (
    # sketchybar
      # --animate tanh 30
      # --set $name
        # icon.y_offset=6
        # icon.y_offset=0
  # )
}

def main () {
  match $env.SENDER {
    "front_app_switched" => {
      switch_front_app $env.INFO
    }
    _ => {}
  }
}
