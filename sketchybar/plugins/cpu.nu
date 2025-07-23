#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "cpu"
export const graph_name = $"($name).graph"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name right
      --set $name
        label.padding_right=5
        icon.padding_left=5
        icon=""
        popup.align=center
        popup.background.color=$"($colors.mantle)"
        popup.background.border_color=$"($colors.overlay2)"
        popup.background.border_width=1
        popup.background.corner_radius=5
        popup.background.height=25
        script=$"($nu.current-exe) ($current_path)"
        update_freq=20
      --subscribe $name
        mouse.entered
        mouse.exited
      --add graph $graph_name $"popup.($name)" 64
      --set $graph_name
        graph.color=$"($colors.green)"
        width=100
        background.height=25
  )
}

def main () {
  match $env.SENDER? {
    "mouse.entered" => {
      (
        sketchybar
          --set $name
            popup.drawing=on
      )
    }
    "mouse.exited" => {
      (
        sketchybar
          --set $name
            popup.drawing=off
      )
    }
    _ => {
      let cpu_usage = (sys cpu -l | get cpu_usage | math sum) / 8 | math round --precision 1
      let graph_color = match $cpu_usage {
        1..25 => { $colors.green }
        26..50 => { $colors.yellow }
        51..75 => { $colors.peach }
        _ => { $colors.red }
      }
      (
        sketchybar
          --set $name
            label=$"($cpu_usage)%"
            graph.color=$"($graph_color)"
          --push $graph_name
            $"($cpu_usage / 100)"
      )
    }
  }
}
