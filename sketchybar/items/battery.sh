#!/bin/bash

source "$CONFIG_DIR/colors.sh"

battery=(
    label.color="$BATTERY"
    label.shadow.drawing=off

    background.color="$BATTERY_BACKGROUND"
    update_freq=120
    script="$PLUGIN_DIR/battery.sh"
)

sketchybar \
    --add item battery right \
    --set battery "${battery[@]}" \
    --subscribe battery system_woke power_source_change
