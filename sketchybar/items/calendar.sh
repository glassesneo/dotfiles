#!/bin/bash

source "$CONFIG_DIR/colors.sh"

calendar=(
  label.color="$CALENDAR"
  label.shadow.drawing=off

  background.color="$CALENDAR_BACKGROUND"
  background.border_color="$CALENDAR"
  background.border_width=2
  update_freq=30
  script="$PLUGIN_DIR/calendar.sh"
  # label="$(date +'%b %d(%a) %H:%M')"
)

sketchybar --add item calendar right \
           --set calendar "${calendar[@]}"
