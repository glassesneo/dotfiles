#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "front_app"
export const list_name = $"($name).app_list"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name left
      --set $name
        padding_left=10
        # background.clip=1.0
        display=active
        label.font.style=Bold
        label.font.size=18
        label.padding_right=0
        icon.font="sketchybar-app-font:Regular:20.0"
        icon.padding_right=2
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name
        front_app_switched
        mouse.entered
        mouse.exited
      # --add item $"($popup_name).1" $"popup.($name)"
      # --add item $"($popup_name).2" $"popup.($name)"
      # --set $"($popup_name).1"
      #   label=1
      # --set $"($popup_name).2"
      #   label=2
  )
  # utils set_item_unit $"($popup_name).1" $crust $overlay0
  # utils set_item_unit $"($popup_name).2" $crust $overlay0
  (
    sketchybar
      --add item $list_name left
      --set $list_name
        label.drawing=off
        icon.font="sketchybar-app-font:Regular:18.0"
        icon.color=$"($colors.text)"
        icon.padding_right=12
        icon.width=0
        background.color=$"($colors.surface0)"
        background.corner_radius=30
        background.height=32
        background.y_offset=2
        y_offset=-3
  )
}

def get_icon (): string -> string {
  let content = cat ~/.config/sketchybar_icon_map.sh
  return (bash -c $content -- $in)
}

def switch_front_app (app_name: string) {
  let icon = $app_name | get_icon
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

def current_apps (): nothing -> list<string> {
  aerospace list-apps --format '%{app-name}' --json | from json | get app-name
}

def show_app_list () {
  let focused_app = sketchybar --query front_app | from json | get label.value
  let icons = current_apps
  | where {|app| $app != $focused_app}
  | each {|app| $app | get_icon }
  | str join " "
  (
    sketchybar
      --set $list_name
        icon.width=-1
  )
  (
    sketchybar
      --animate tanh 20
      --set $list_name
        icon=$"($icons)"
  )
}

def hide_app_list () {
  (
    sketchybar
      --animate tanh 20
      --set $list_name
        icon.width=0
  )
  sleep 0.2sec
  (
    sketchybar
      --set $list_name
        icon=""
  )
}

def main () {
  match $env.SENDER {
    "front_app_switched" => {
      switch_front_app $env.INFO
    }
    # "mouse.entered" => {
      # show_app_list
    # }
    # "mouse.exited" => {
      # hide_app_list
    # }
    _ => {}
  }
}

