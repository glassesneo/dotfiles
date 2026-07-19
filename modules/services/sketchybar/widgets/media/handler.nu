use ../../colors.nu

const name = "@name@"
const cache_path = "@cache-path@"
const hover_token_path = "@hover-token-path@"
const media_control = "@media-control@"

def main () {
  match $env.SENDER {
    "mouse.entered" => {
      show_artwork_after_hover_delay
    },
    "mouse.exited" | "mouse.exited.global" | "display_change" => {
      cancel_pending_hover
      close_artwork
    },
    "media_stream_play" => {
      let payload = $env.PAYLOAD | from json
      show_media ($payload | label_text)
      refresh_artwork
    },
    "media_stream_pause" => {
      cancel_pending_hover
      disable_artwork
      hide_media
    },
    "forced" => {
      handle_forced
    },
    _ => {
      cancel_pending_hover
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
    cancel_pending_hover
    disable_artwork
    hide_media
  }
}

def show_artwork_after_hover_delay [] {
  let token = random uuid
  let pending_token_path = $"($hover_token_path).($token)"
  let token_stored = try {
    mkdir ($hover_token_path | path dirname)
    $token | save --force $pending_token_path
    mv --force $pending_token_path $hover_token_path
    true
  } catch {
    try { rm --force $pending_token_path }
    false
  }

  if not $token_stored {
    return
  }

  sleep 500ms
  let current_token = try {
    open --raw $hover_token_path | str trim
  } catch {
    null
  }
  if $current_token == $token {
    refresh_artwork --show-popup
  }
}

def cancel_pending_hover [] {
  try { rm --force $hover_token_path }
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
