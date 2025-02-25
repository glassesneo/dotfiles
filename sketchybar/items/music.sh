music=(
    label.padding_right=8
    padding_right=16
    icon="♪"
    icon.padding_left=36
    # label="loading.."
    update_freq=5
    script="$PLUGIN_DIR/music.sh"
    # --subscribe music media_change system_woke
)
sketchybar \
    --add item music right \
    --set music "${music[@]}"
