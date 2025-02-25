#!/usr/bin/env nu
use std/log

# def main [workspace?: string] {
#   log info "aerospace!!!!!!!!!!!"
#   let state: record = if ($workspace == ($env.FOCUSED_WORKSPACE? | default "")) {
#     {
#       color: "0x00000000"
#       drawing: "off"
#     }
#   } else {
#     {
#       color: "0x44ffffff"
#       drawing: "on"
#     }
#   }
#
#   sketchybar --set $env.NAME $"background.color=($state | get color)" $"background.drawing=($state | get drawing)"
# }

sketchybar --set $env.NAME "background.color=0x44ffffff"
