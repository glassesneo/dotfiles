const media_control = "@media-control@"
const cache_path = "@cache-path@"
const sips = "@sips@"
const source_path = "@cache-path@.source.tmp"
const normalized_path = "@cache-path@.normalized.tmp.png"

def cleanup_temporary_files [] {
  for path in [$source_path $normalized_path] {
    if ($path | path exists) {
      rm --force $path
    }
  }
}

def invalidate_artwork [] {
  cleanup_temporary_files
  if ($cache_path | path exists) {
    rm --force $cache_path
  }
}

def cache_artwork [artwork_data: string] {
  mkdir ($cache_path | path dirname)
  cleanup_temporary_files

  let published = try {
    $artwork_data | decode base64 | save --raw --force $source_path

    let resize = (
      do {
        ^$sips --setProperty format png --resampleHeightWidthMax 192 $source_path --out $normalized_path
      } | complete
    )

    if $resize.exit_code != 0 or not ($normalized_path | path exists) {
      false
    } else {
      let verify = (do { ^$sips --getProperty format $normalized_path } | complete)
      if $verify.exit_code != 0 {
        false
      } else {
        mv --force $normalized_path $cache_path
        $cache_path | path exists
      }
    }
  } catch {
    false
  }

  cleanup_temporary_files
  if not $published and ($cache_path | path exists) {
    rm --force $cache_path
  }

  $published
}

def visible_state [payload: record] {
  {
    playing: ($payload | get playing? | default false)
    artist: ($payload | get artist? | default null)
    title: ($payload | get title? | default null)
    album: ($payload | get album? | default null)
    artworkData: ($payload | get artworkData? | default null)
  }
}

def active_artwork [payload: record] {
  if ($payload | get playing? | default false) {
    $payload | get artworkData? | default null
  } else {
    null
  }
}

def trigger_play [payload: record] {
  let metadata = {
    artist: ($payload | get artist? | default null)
    title: ($payload | get title? | default null)
    album: ($payload | get album? | default null)
  } | to json --raw
  sketchybar --trigger media_stream_play $"PAYLOAD=($metadata)" | ignore
}

def handle_visible_state [payload: record, previous: any] {
  if not ($payload | get playing? | default false) {
    invalidate_artwork
    sketchybar --trigger media_stream_pause | ignore
    return
  }

  let artwork_data = active_artwork $payload
  let previous_artwork = if $previous == null { null } else { active_artwork $previous }
  if $previous == null or $artwork_data != $previous_artwork {
    let artwork_missing = $artwork_data == null or ($artwork_data | is-empty)
    if $artwork_missing {
      invalidate_artwork
    } else {
      cache_artwork $artwork_data | ignore
    }
  }

  trigger_play $payload
}

def main [] {
  invalidate_artwork
  mut current = {}
  mut previous_visible: any = null

  let initial = try {
    ^$media_control get | from json
  } catch {
    null
  }
  if $initial != null and ($initial | describe) =~ '^record' {
    $current = $initial
    handle_visible_state $current null
    $previous_visible = visible_state $current
  }

  for line in (^$media_control stream --debounce=100 | lines) {
    let data = try {
      $line | from json
    } catch {
      continue
    }
    let payload = $data | get payload?
    if $payload == null or ($payload | describe) !~ '^record' {
      continue
    }

    let previous = $current
    let is_diff = $data | get diff? | default false
    $current = if $is_diff { $current | merge $payload } else { $payload }
    let next_visible = visible_state $current
    if $previous_visible == null or $next_visible != $previous_visible {
      handle_visible_state $current $previous
      $previous_visible = $next_visible
    }
  }
}
