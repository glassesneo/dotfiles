use std/log
use ../../colors.nu

def main [direction: string] {
  const name = "@name@"
  let options = [
    display=active
    icon=
    icon.padding_left=7
    icon.padding_right=4
    label=""
    label.padding_right=7
    label.drawing=off
    background.drawing=on
    $"background.color=($colors.island_surface)"
    background.corner_radius=12
    background.height=28
    background.border_width=2
    $"background.border_color=($colors.island_border)"
    popup.drawing=off
    popup.horizontal=off
    popup.align=left
    popup.y_offset=8
    popup.blur_radius=12
    popup.background.drawing=on
    $"popup.background.color=($colors.island_surface)"
    popup.background.corner_radius=14
    popup.background.border_width=2
    $"popup.background.border_color=($colors.island_border)"
    script="@script-path@"
    click_script="@script-path@ click-main"
  ]
  sketchybar --add event notifications_changed
  sketchybar --add item $name $direction
  sketchybar --set $name ...$options
  # Main clicks use click_script only; subscribing mouse.clicked too would toggle twice.
  sketchybar --subscribe $name notifications_changed forced display_change mouse.entered mouse.exited mouse.exited.global
  log info "Rendered notifications widget"
}
