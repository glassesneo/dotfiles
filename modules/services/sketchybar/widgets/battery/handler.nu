def main () {
  const name = "@name@"
  let percentage = pmset -g batt
    | lines
    | find '%;'
    | split words
    | get 0
    | get 5
    | into int

  if (pmset -g batt | lines | find "AC Power" | length) != 0 {
    let options = [
      $"icon=($percentage)%"
      "label="
      "label.color=0xFFFFFF00"
    ]

    sketchybar --set $name ...$options

    return
  }

  let icon: record<kind: string, color: string> = match $percentage {
    91..100 => {kind: $"\u{f240}", color: "0xFF00FF00"}
    61..90 => {kind: $"\u{f241}", color: "0xFFFFFF00"}
    31..60 => {kind: $"\u{f242}", color: "0xFFFFA500"}
    11..30 => {kind: $"\u{f243}", color: "0xFFFF0000"}
    _ => {kind: $"\u{f244}", color: "0xFFFF0000"}
  }

  let options = [
    $"icon=($percentage)%"
    $"label=($icon.kind)"
    $"label.color=($icon.color)"
  ]

  sketchybar --set $name ...$options
}
