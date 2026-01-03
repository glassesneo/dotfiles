#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "ai"
const claude_popup = $"($name).claude"
const opencode_popup = $"($name).opencode"

# Nerd Font icon for AI status
const ICON = "󰚩"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  # Create custom events for AI status updates
  sketchybar --add event claude_status
  sketchybar --add event opencode_status

  # Create the AI status item with popup containing two rows (hidden by default)
  (
    sketchybar
      --add item $name right
      --set $name
        icon=$"($ICON)"
        icon.color=$"($colors.overlay0)"
        icon.font.size=18
        icon.padding_left=6
        icon.padding_right=6
        label.drawing=off
        popup.align=center
        popup.background.color=$"($colors.mantle)"
        popup.background.border_color=$"($colors.overlay2)"
        popup.background.border_width=1
        popup.background.corner_radius=8
        popup.background.padding_left=8
        popup.background.padding_right=8
        script=$"($nu.current-exe) ($current_path)"
      --subscribe $name
        claude_status
        opencode_status
        mouse.entered
        mouse.exited

      # Claude status row (hidden by default)
      --add item $claude_popup $"popup.($name)"
      --set $claude_popup
        drawing=off
        icon="󰧑"
        icon.color=$"($colors.mauve)"
        icon.font.size=18
        icon.padding_left=6
        icon.padding_right=8
        label=""
        label.color=$"($colors.text)"
        label.font.size=14
        background.padding_left=4
        background.padding_right=4

      # OpenCode status row (hidden by default)
      --add item $opencode_popup $"popup.($name)"
      --set $opencode_popup
        drawing=off
        icon="󰆧"
        icon.color=$"($colors.blue)"
        icon.font.size=18
        icon.padding_left=6
        icon.padding_right=8
        label=""
        label.color=$"($colors.text)"
        label.font.size=14
        background.padding_left=4
        background.padding_right=4
  )
}

# Update main icon color based on whether any agent is active
def update_main_icon () {
  let claude_drawing = (sketchybar --query $claude_popup | from json | get geometry.drawing)
  let opencode_drawing = (sketchybar --query $opencode_popup | from json | get geometry.drawing)

  let any_active = ($claude_drawing == "on") or ($opencode_drawing == "on")

  if $any_active {
    sketchybar --set $name icon.color=$"($colors.green)"
  } else {
    sketchybar --set $name icon.color=$"($colors.overlay0)"
  }
}

def set_claude_active (project_dir: string = "") {
  let dir_info = if ($project_dir | is-empty) {
    "Working..."
  } else {
    $project_dir
  }

  (
    sketchybar
      --set $claude_popup
        drawing=on
        label=$"($dir_info)"
  )
  update_main_icon
}

def set_claude_inactive () {
  sketchybar --set $claude_popup drawing=off
  update_main_icon
}

def set_opencode_active (project_dir: string = "") {
  let dir_info = if ($project_dir | is-empty) {
    "Working..."
  } else {
    $project_dir
  }

  (
    sketchybar
      --set $opencode_popup
        drawing=on
        label=$"($dir_info)"
  )
  update_main_icon
}

def set_opencode_inactive () {
  sketchybar --set $opencode_popup drawing=off
  update_main_icon
}

def main () {
  match $env.SENDER {
    "claude_status" => {
      match ($env.STATUS? | default "inactive") {
        "active" => {
          let project_dir = ($env.PROJECT_DIR? | default "")
          set_claude_active $project_dir
        }
        "inactive" => { set_claude_inactive }
        _ => { set_claude_inactive }
      }
    }
    "opencode_status" => {
      match ($env.STATUS? | default "inactive") {
        "active" => {
          let project_dir = ($env.PROJECT_DIR? | default "")
          set_opencode_active $project_dir
        }
        "inactive" => { set_opencode_inactive }
        _ => { set_opencode_inactive }
      }
    }
    "mouse.entered" => {
      # Only show popup if at least one agent is active
      let claude_drawing = (sketchybar --query $claude_popup | from json | get geometry.drawing)
      let opencode_drawing = (sketchybar --query $opencode_popup | from json | get geometry.drawing)

      if ($claude_drawing == "on") or ($opencode_drawing == "on") {
        sketchybar --set $name popup.drawing=on
      }
    }
    "mouse.exited" => {
      sketchybar --set $name popup.drawing=off
    }
    _ => {}
  }
}
