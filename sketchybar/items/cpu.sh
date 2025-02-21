#!/bin/bash

source "$CONFIG_DIR/colors.sh"

sketchybar \
    --add item cpu right \
    --set cpu update_freq=2 script="$PLUGIN_DIR/cpu.sh" background.color="$CPU_BACKGROUND" label.color="$CPU"

