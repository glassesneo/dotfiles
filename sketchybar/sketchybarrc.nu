#!/usr/bin/env nu
use std/log
use utils.nu
use colors.nu

const font = "HackGen Console NF"

def run [plugin_dir: string] {
  sketchybar --reload

  let bar = [
  ] | utils list_to_args

  sketchybar --bar $bar
  (
    sketchybar
      --bar
        height=32
        blur_radius=30
        position=top
        margin=5,
        corner_radius=5,
        topmost=window,
        shadow=off,
        sticky=off,
        y_offset=3,
        color=$"($bar_color)"

      --default
        icon.font=$"($font):Bold:16.0"
        label.font=$"($font):Bold:16.0"
        icon.padding_left=4
        icon.padding_right=4
        label.padding_left=4
        label.padding_right=4
        label.color=$"($text)"
        background.color=$"($base)"
        background.corner_radius=5
        background.height=24
        # background.border_width=2
        # background.border_color=$"($base)"
  )
  # sketchybar --default label.color=$"($text)" background.color=$"($base)"

  use ./plugins/calendar.nu; calendar item
  use ./plugins/volume.nu; volume item

  sketchybar --add event aerospace_workspace_change

  aerospace list-workspaces --all | lines | each {|space_id|
    let space = $"space.($space_id)"

    (
      sketchybar
        --add item $space left
        --subscribe $space aerospace_workspace_change
        --set $space
          label.color=$"($text)"
          label=$"($space_id)"
          click_script="aerospace workspace ($space_id)"
          background.height=20
    )
  }
}

def main () {
  log info "sketchybar: loading config.."

  let plugin_dir: string = $env.XDG_CONFIG_HOME | path join "plugins"
  run plugin_dir

  log info "sketchybar: finish loading config"
  sketchybar --update
}

def 'main test' () {
  log info "sketchybar: loading test config.."

  let plugin_dir: string = $env.FILE_PWD | path join "plugins/"
  run plugin_dir

  log info "sketchybar: finish loading test config"
  sketchybar --update
}
