const name = "@name@"

def main () {
  match $env.SENDER {
    "media_stream_change" => handle_media_stream_change
    _ => ()
  }
}

def label_text (): record -> string {
  $"($in | get title) • ($in | get artist)"
}

def handle_media_stream_change () {
  let payload = $env.PAYLOAD | from json
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
    background.border_color=0x80f5bde6
  ]
  sketchybar --set $name ...$options
  sketchybar --animate tanh 30 --set $name ...$animated_options
}

def hide_media () {
  let animated_options = [
    label=──
    background.border_color=0x14000000
  ]
  let options = [
    scroll_texts=off
  ]
  sketchybar --animate tanh 30 --set $name ...$animated_options
  sketchybar --set $name ...$options
}
