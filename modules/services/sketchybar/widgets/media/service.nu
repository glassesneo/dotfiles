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

def trigger_play [payload: record] {
  let metadata = $payload | select artist title album | to json
  sketchybar --trigger media_stream_play $"PAYLOAD=($metadata)" | ignore
}

def handle_payload [payload: record, previous_artwork: any] {
  if not ($payload | get playing? | default false) {
    invalidate_artwork
    sketchybar --trigger media_stream_pause | ignore
    return null
  }

  let artwork_data = $payload | get artworkData? | default null
  let artwork_missing = $artwork_data == null or ($artwork_data | is-empty)
  let cache_current = (
    not $artwork_missing
    and $previous_artwork != null
    and $artwork_data == $previous_artwork
    and ($cache_path | path exists)
  )

  let artwork_valid = if $cache_current {
    true
  } else if $artwork_missing {
    invalidate_artwork
    false
  } else {
    cache_artwork $artwork_data
  }

  trigger_play $payload
  if $artwork_valid { $artwork_data } else { null }
}

def main [] {
  invalidate_artwork
  mut previous_artwork: any = null

  let initial = try {
    ^$media_control get | from json
  } catch {
    null
  }
  if $initial != null {
    $previous_artwork = (handle_payload $initial $previous_artwork)
  }

  for line in (^$media_control stream --no-diff | lines) {
    let data = try {
      $line | from json
    } catch {
      continue
    }
    if ($data | get payload? | compact | is-empty) {
      continue
    }

    let payload = $data | get payload
    $previous_artwork = (handle_payload $payload $previous_artwork)
  }
}
