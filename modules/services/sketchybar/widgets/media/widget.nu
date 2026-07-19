use std/log
use ../../colors.nu

def main [direction: string] {
  const name = "@name@"
  const artwork_anchor = "@name@.artwork-anchor"

  log info $"Rendering ($name)"
  let widget_options = [
    display=active
    padding_right=12
    label=──
    label.max_chars=28
    label.padding_right=10
    label.scroll_duration=180
    scroll_texts=off
    icon=
    icon.padding_left=8
    icon.padding_right=8
    blur_radius=12
    background.drawing=on
    $"background.color=($colors.island_surface)"
    background.corner_radius=12
    background.height=28
    background.border_width=2
    $"background.border_color=($colors.island_border)"
    popup.drawing=off
    popup.horizontal=on
    popup.align=center
    popup.y_offset=8
    popup.blur_radius=12
    popup.background.drawing=on
    $"popup.background.color=($colors.island_surface)"
    popup.background.corner_radius=14
    popup.background.border_width=2
    $"popup.background.border_color=($colors.island_border)"
    popup.background.image.drawing=off
    popup.background.image.scale=1.0
    popup.background.image.corner_radius=12
    popup.background.image.padding_left=6
    popup.background.image.padding_right=6
    script="@script-path@"
  ]
  let anchor_options = [
    drawing=off
    width=0
    icon.drawing=off
    label.drawing=off
  ]

  sketchybar --add event media_stream_play
  sketchybar --add event media_stream_pause
  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
  sketchybar --add item $artwork_anchor $"popup.($name)"
  sketchybar --set $artwork_anchor ...$anchor_options
  sketchybar --subscribe $name media_stream_play media_stream_pause display_change mouse.entered mouse.exited mouse.exited.global
}
