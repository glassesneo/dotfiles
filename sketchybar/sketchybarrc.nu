#!/usr/bin/env nu
use std/log
use colors.nu

const font = "HackGen Console NF"

def run [plugin_dir: string] {
  sketchybar --reload

  (
    sketchybar
      --bar
        height=40
        blur_radius=30
        position=top
        margin=5,
        corner_radius=10,
        topmost=window,
        shadow=off,
        sticky=on,
        y_offset=5,
        color=$"($base)"
        # border_width=4
        # border_color=$"($mantle)"

      --default
        icon.font=$"($font):Bold:20.0"
        label.font=$"($font):Bold:18.0"
        label.padding_left=6
        label.padding_right=6
        label.color=$"($text)"
        icon.padding_left=6
        icon.padding_right=6
        icon.color=$"($text)"
  )

  use ./plugins/workspace.nu; workspace item; workspace trigger
  use ./plugins/front_app.nu; front_app item
  use ./plugins/datetime.nu; datetime clock item; datetime calendar item
  use ./plugins/battery.nu; battery item
  use ./plugins/volume.nu; volume item
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
