use ../../colors.nu

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
      $"label.color=($colors.status_charging)"
    ]

    sketchybar --set $name ...$options

    return
  }

  let icon: record<kind: string, color: string> = match $percentage {
    91..100 => {kind: $"\u{f240}", color: $colors.status_success}
    61..90 => {kind: $"\u{f241}", color: $colors.status_success}
    31..60 => {kind: $"\u{f242}", color: $colors.status_warning}
    11..30 => {kind: $"\u{f243}", color: $colors.status_caution}
    _ => {kind: $"\u{f244}", color: $colors.status_error}
  }

  let options = [
    $"icon=($percentage)%"
    $"label=($icon.kind)"
    $"label.color=($icon.color)"
  ]

  sketchybar --set $name ...$options
}
