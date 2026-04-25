use ../../colors.nu

const name = "@name@"
const media_control = "@media-control@"

def main () {
  let payload = match $env.SENDER {
    "media_stream_play" => ($env.PAYLOAD | from json),
    "media_stream_pause" => {
      hide_media
      return
    },
    "forced" => (^$media_control get | from json | select artist title album),
    _ => {
      hide_media
      return
    },
  }

  let label = $payload | label_text
  show_media $label
}

def label_text (): record -> string {
  $"($in | get title) • ($in | get artist)"
}

def show_media (label: string) {
  let options = [
    icon=
    scroll_texts=on
  ]
  let animated_options = [
    $"label=($label)"
    $"background.border_color=($colors.active_indicator)"
  ]
  sketchybar --set $name ...$options
  sketchybar --animate tanh 32 --set $name ...$animated_options
}

def hide_media () {
  let animated_options = [
    label=──
    $"background.border_color=($colors.island_border)"
  ]
  let options = [
    scroll_texts=off
  ]
  sketchybar --animate tanh 30 --set $name ...$animated_options
  sketchybar --set $name ...$options
}
