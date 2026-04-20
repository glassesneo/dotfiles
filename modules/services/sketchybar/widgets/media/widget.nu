use std/log

def main [direction: string] {
  const name = "@name@"

  log info $"Rendering ($name)"
  let widget_options = [
    display=active
    padding_right=12
    label=──
    label.max_chars=28
    label.scroll_duration=180
    scroll_texts=off
    icon=
    icon.padding_left=8
    icon.padding_right=8
    blur_radius=12
    background.drawing=on
    background.color=0x18000000
    background.corner_radius=12
    background.height=28
    background.border_width=1
    background.border_color=0x14000000
    script="@script-path@"
  ]

  sketchybar --add event media_stream_change
  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
  sketchybar --subscribe $name media_stream_change
}
