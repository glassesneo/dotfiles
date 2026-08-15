#!/usr/bin/env bash
set -euo pipefail

media_dir=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT

bin="$fixture/bin"
cache_path="$fixture/cache/artwork.png"
sketchybar_log="$fixture/sketchybar.log"
sips_log="$fixture/sips.log"
media_control_log="$fixture/media-control.log"
service="$fixture/service.nu"
mkdir -p "$bin"
cp "$media_dir/service.nu" "$service"

cat >"$bin/media-control" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$MEDIA_CONTROL_LOG"
case ${1:-} in
  get)
    printf '%s\n' '{"playing":true,"artist":"Artist A","title":"Title A","album":"Album A","artworkData":"QQ==","elapsedTime":1}'
    ;;
  stream)
    cat <<'STREAM'
{"diff":true,"payload":{"elapsedTime":2}}
{"diff":true,"payload":{"elapsedTime":3,"application":"Music"}}
{"diff":true,"payload":{"title":"Title B"}}
{"diff":true,"payload":{"title":"Title B"}}
{"diff":true,"payload":{"title":null}}
{"diff":true,"payload":{"artworkData":"Qg=="}}
{"diff":false,"payload":{"playing":true,"title":"Replacement"}}
{"diff":true,"payload":{"artist":"Artist R"}}
{"diff":false,"payload":{}}
STREAM
    ;;
esac
EOF
chmod +x "$bin/media-control"

cat >"$bin/sketchybar" <<'EOF'
#!/usr/bin/env bash
cache_state=absent
if [[ -e $ARTWORK_CACHE_PATH ]]; then cache_state=present; fi
printf '%s cache=%s\n' "$*" "$cache_state" >>"$SKETCHYBAR_LOG"
EOF
chmod +x "$bin/sketchybar"

cat >"$bin/sips" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$SIPS_LOG"
if [[ $* == *'--setProperty format png'* ]]; then
  output=
  previous=
  for argument in "$@"; do
    if [[ $previous == --out ]]; then output=$argument; fi
    previous=$argument
  done
  [[ -n $output ]]
  printf 'normalized artwork\n' >"$output"
else
  printf '  format: png\n'
fi
EOF
chmod +x "$bin/sips"

sed -i \
  -e "s#@cache-path@#$cache_path#g" \
  -e "s#@media-control@#$bin/media-control#g" \
  -e "s#@sips@#$bin/sips#g" \
  "$service"

fail() {
  echo "media service test failed: $*" >&2
  exit 1
}

export PATH="$bin:$PATH"
export SKETCHYBAR_LOG="$sketchybar_log"
export SIPS_LOG="$sips_log"
export MEDIA_CONTROL_LOG="$media_control_log"
export ARTWORK_CACHE_PATH="$cache_path"
nu --no-config-file "$service"

mapfile -t play_events < <(grep 'media_stream_play' "$sketchybar_log" || true)
[[ ${#play_events[@]} == 6 ]] || fail "expected 6 visible play transitions, got ${#play_events[@]}"
[[ ${play_events[0]} == *'Title A'* && ${play_events[0]} == *'Artist A'* ]] || fail "initial full state was not published"
[[ ${play_events[1]} == *'Title B'* && ${play_events[1]} == *'Artist A'* && ${play_events[1]} == *'Album A'* ]] || fail "partial title diff did not preserve prior metadata"
[[ ${play_events[2]} == *'"title":null'* && ${play_events[2]} != *'Title B'* ]] || fail "explicit null did not clear the title"
[[ ${play_events[4]} == *'Replacement'* && ${play_events[4]} == *'"artist":null'* && ${play_events[4]} == *'"album":null'* ]] || fail "full replacement retained omitted metadata"
[[ ${play_events[4]} == *'cache=absent'* ]] || fail "full replacement retained omitted artwork"
[[ ${play_events[5]} == *'Replacement'* && ${play_events[5]} == *'Artist R'* ]] || fail "diff after full replacement did not merge into replacement state"

pause_count=$(grep -c 'media_stream_pause' "$sketchybar_log" || true)
[[ $pause_count == 1 ]] || fail "empty full snapshot did not produce exactly one pause transition"
conversion_count=$(grep -c -- '--setProperty format png' "$sips_log" || true)
[[ $conversion_count == 2 ]] || fail "expected artwork conversion only for the initial and changed artwork, got $conversion_count"
[[ ! -e $cache_path ]] || fail "empty full snapshot did not leave artwork cleared"
grep -Fxq 'stream --debounce=100' "$media_control_log" || fail "service did not request the normal diff stream"
