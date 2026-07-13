use ../../colors.nu

const name = "@name@"
const cache_path = "@cache-path@"
const media_control = "@media-control@"

def main () {
  match $env.SENDER {
    "mouse.entered" => {
      refresh_artwork --show-popup
    },
    "mouse.exited" | "mouse.exited.global" => {
      close_artwork
    },
    "media_stream_play" => {
      let payload = $env.PAYLOAD | from json
      show_media ($payload | label_text)
      refresh_artwork
    },
    "media_stream_pause" => {
      disable_artwork
      hide_media
    },
    "forced" => {
      handle_forced
    },
    _ => {
      disable_artwork
      hide_media
    },
  }
}

def handle_forced [] {
  let state = try {
    ^$media_control get | from json
  } catch {
    null
  }

  if $state != null and ($state | get playing? | default false) {
    show_media ($state | select artist title album | label_text)
    refresh_artwork
  } else {
    disable_artwork
    hide_media
  }
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

def close_artwork [] {
  sketchybar --set $name popup.drawing=off
}

def disable_artwork [] {
  sketchybar --set $name popup.drawing=off popup.background.image.drawing=off
}

def refresh_artwork [--show-popup] {
  if ($cache_path | path exists) {
    let options = [
      $"popup.background.image=($cache_path)"
      popup.background.image.drawing=on
    ]
    sketchybar --set $name ...$options
    if $show_popup {
      sketchybar --set $name popup.drawing=on
    }
  } else {
    disable_artwork
  }
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
