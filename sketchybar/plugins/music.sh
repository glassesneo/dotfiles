# CURRENT_SONG="$(/etc/profiles/per-user/neo/bin/nowplaying-cli get title)"
# CURRENT_ARTIST="$(/etc/profiles/per-user/neo/bin/nowplaying-cli get artist)"
title=$("$PLUGIN_DIR/music.scpt")

if [[ "$title" == "YouTube Music" ]]; then
    CURRENT_SONG="No playing song"
else
    # CURRENT_SONG="${title% - YouTube Music}" # " - YouTube Music" を削除
    CURRENT_SONG="Now playing"
fi

sketchybar --set "music" label="${CURRENT_SONG}" drawing=on
