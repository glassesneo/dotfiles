#!/usr/bin/env nu
use std/log
use colors.nu

const font = "Hack Nerd Font Mono"

def run [plugin_dir: string] {
  sketchybar --reload

  (
    sketchybar
      --bar
        height=45
        blur_radius=30
        position=top
        # margin=5,
        # corner_radius=10,
        # corner_radius.bottom_left=12
        # corner_radius.bottom_right=12
        topmost=window,
        shadow=off,
        sticky=on,
        # y_offset=5,
        color=$"($opaque_crust)"
        # color=0x00ffffff
        # border_width=4
        # border_color=$"($mantle)"

      --default
        padding_left=5
        padding_right=5
        icon.font=$"($font):Bold:19"
        label.font=$"($font):Bold:17"
        icon.padding_left=12
        label.padding_left=6
        label.padding_right=12
        label.color=$"($text)"
        # icon.padding_left=6
        # icon.padding_right=6
        icon.color=$"($text)"
        y_offset=0
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
