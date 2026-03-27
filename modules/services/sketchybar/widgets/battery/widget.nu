use std/log

def main [direction: string] {
  const name = "@name@"

  log info $"Rendering ($name)"
  let widget_options = [
    script="@script-path@"
    update_freq=120
    icon.font.style=Regular
    icon.font.size=14
    label.font.style=Bold
    label.font.size=15
  ]

  sketchybar --add item $name $direction
  sketchybar --set $name ...$widget_options
  sketchybar --subscribe $name system_woke power_source_change
}

