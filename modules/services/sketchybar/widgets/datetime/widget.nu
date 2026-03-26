use std/log

def main [direction: string] {
  const name = "@name@"

  log info $"Rendering ($name)"
  let widget_options = [
      script="@script-path@"
      update_freq=30
  ]

  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
}
