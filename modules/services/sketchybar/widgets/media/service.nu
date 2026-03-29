use std/log

def main [] {
  media-control stream --no-diff | lines | each {|line|
    let data = $line | from json
    if ($data | get payload? | compact | is-empty) {
      return
    }

    let payload = $data | get payload | select artist title album playing
    sketchybar --trigger media_stream_change $"PAYLOAD=($payload | to json)"
    log info "triggered!"
    echo $payload
  }
}
