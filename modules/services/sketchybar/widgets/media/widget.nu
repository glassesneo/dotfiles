use std/log
use ../../colors.nu

def main [direction: string] {
  const name = "@name@"

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
    script="@script-path@"
  ]

  sketchybar --add event media_stream_play
  sketchybar --add event media_stream_pause
  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
  sketchybar --subscribe $name media_stream_play media_stream_pause
}
