#!/usr/bin/env nu
use std/log
use ../colors.nu
use ../utils.nu

export const name = "media"

export def item () {
  log info $"Rendering ($name)"
  let current_path = $name | utils get_current_path

  (
    sketchybar
      --add item $name center
      --set $name
        display=active
        label="──"
        label.padding_left=12
        label.padding_right=12
        label.color=$"($text)"
        label.font.family="HackGen Console NF"
        label.font.size=15
        label.font.style=Bold
        label.max_chars=30
        label.scroll_duration=180
        scroll_texts=off
        icon=""
        icon.color=$"($text)"
        script=$"($nu.current-exe) ($current_path)"
        update_freq=120
      --subscribe $name
        media_change
        mouse.entered
        mouse.exited
  )
  # for storing media info
  # label: text to display
  # icon: player state
  (
    sketchybar
      --add item current_media center
      --set current_media
        drawing=off
  )

  utils set_item_unit $name $crust $overlay0
}

def label_text (): record<state: string, title: string, artist: string> -> string {
  $"($in | get title) • ($in | get artist)"
}

def show_media_info (label_text: string) {
  (
    sketchybar
      --set $name
        scroll_texts=on
  )
  (
    sketchybar
      --animate tanh 30
      --set $name
        label=$"($label_text)"
  )
}

def hide_media_info () {
  (
    sketchybar
      --animate tanh 30
      --set $name
        label="──"
        icon.color=$"($text)"
        background.border_color=$"($overlay0)"
  )
  (
    sketchybar
      --set $name
        scroll_texts=off
  )
}

def update_media (media_info: record<state: string, title: string, artist: string>) {
  let state = $media_info | get state
  match $state {
    "playing" => {
      (
        sketchybar --set $name
          icon.color=$"($red)"
          background.border_color=$"($flamingo)"
      )
      show_media_info ($media_info | label_text)
    }
    "paused" => {
      hide_media_info
    }
    _ => {
      hide_media_info
    }
  }
}

def main () {
  match $env.SENDER {
    "media_change" => {
      let media_info = $env.INFO | from json | select state title artist
      (
        sketchybar --set current_media
          label=$"($media_info | label_text)"
          icon=$"($media_info | get state)"
      )
      update_media $media_info
    }
    "mouse.entered" => {
      let label_text = sketchybar --query current_media | from json | get label.value
      show_media_info $label_text
    }
    "mouse.exited" => {
      let state = sketchybar --query current_media | from json | get icon.value
      if ($state) == "playing" {
        return
      }
      hide_media_info
    }
    _ => {}
  }
}
