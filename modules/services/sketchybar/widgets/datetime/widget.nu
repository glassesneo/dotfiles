use std/log

def main [direction: string] {
  const name = "@name@"
  let label_font_style = "Bold Italic"

  log info $"Rendering ($name)"
  let widget_options = [
    script="@script-path@"
    update_freq=30
    $"label.font.style=($label_font_style)"
    # icon.drawing=off
  ]

  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
}
