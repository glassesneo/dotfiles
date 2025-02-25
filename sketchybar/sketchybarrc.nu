#!/usr/bin/env nu
use std/log
use colors.nu

const font = "HackGen Console NF"

def run [plugin_dir: string] {
  sketchybar --reload

  (
    sketchybar
      --bar
        height=32
        blur_radius=30
        position=top
        margin=5,
        corner_radius=8,
        topmost=window,
        shadow=off,
        sticky=off,
        y_offset=3,
        color=$"($base)"
        border_width=3
        border_color=$"($surface0)"

      --default
        icon.font=$"($font):Bold:18.0"
        label.font=$"($font):Bold:16.0"
        label.padding_left=4
        label.padding_right=4
        label.color=$"($text)"
        icon.padding_left=5
        icon.padding_right=5
        icon.background.corner_radius=8
        icon.background.height=25
        icon.color=$"($text)"
        background.color=$"($base)"
        background.corner_radius=8
  )

  sketchybar --add event aerospace_workspace_change

  aerospace list-workspaces --all | lines | each {|space_id|
    let space = $"space.($space_id)"

    (
      sketchybar
        --add item $space left
        --subscribe $space aerospace_workspace_change
        --set $space
          label=$"($space_id)"
          label.padding_left=2
          label.padding_right=2
          click_script="aerospace workspace ($space_id)"
          background.height=20
    )
  }

  use ./plugins/datetime.nu; datetime calendar item
  use ./plugins/volume.nu; volume item
  use ./plugins/battery.nu; battery item
  use ./plugins/front_app.nu; front_app item
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
