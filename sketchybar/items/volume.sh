#!/bin/bash

source "$CONFIG_DIR/colors.sh"

volume=(
    label.color="$VOLUME"
    label.shadow.drawing=off

    background.color="$VOLUME_BACKGROUND"
    script="$PLUGIN_DIR/volume.sh"
)

sketchybar \
    --add item volume right \
    --set volume "${volume[@]}" \
    --subscribe volume volume_change
