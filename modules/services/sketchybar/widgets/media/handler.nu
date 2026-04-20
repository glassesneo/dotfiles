use ../../colors.nu

const name = "@name@"
const media_control = "@media-control@"

def main () {

  let payload = match $env.SENDER {
    "media_stream_change" => ($env.PAYLOAD | from json),
    "forced" => (^$media_control get | from json | select artist title album playing),
    _ => (null),
  }

  handle_media_stream_change ($payload | default {playing: false})
}

def label_text (): record -> string {
  $"($in | get title) • ($in | get artist)"
}

def handle_media_stream_change (payload: record) {
  if ($payload | get playing? | default false) {
    let label = $payload | label_text
    show_media $label
  } else {
    hide_media
  }
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
