use std/log

def main [] {
  media-control stream --no-diff | lines | each {|line|
    let data = $line | from json
    if ($data | get payload? | compact | is-empty) {
      return
    }

    let payload = $data | get payload
    if ($payload | get playing? | default false) {
      sketchybar --trigger media_stream_play $"PAYLOAD=($payload | select artist title album | to json)"
    } else {
      sketchybar --trigger media_stream_pause
    }
  }
}
