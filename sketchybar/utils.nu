#!/usr/bin/env nu
use ./colors.nu

export const item_unit = {
  background: {
    corner_radius: 20,
    height: 29,
    border_width: 1,
  }
}

export def set_item_unit [name: string, bg: string, border: string = $text] {
  (
    sketchybar
      --set $name
        background.color=$"($bg)"
        background.corner_radius=$"($item_unit.background.corner_radius)"
        background.height=$"($item_unit.background.height)"
        background.border_width=$"($item_unit.background.border_width)"
        background.border_color=$"($border)"
  )
}

export def set_item_unit_without_border [name: string, bg: string] {
  (
    sketchybar
      --set $name
        background.color=$"($bg)"
        background.corner_radius=$"($item_unit.background.corner_radius)"
        background.height=$"($item_unit.background.height)"
  )
}

export def icon_color (): string -> string {
  match $in {
    "Arc" => $pink
    "Ghostty" => $blue
    "Obsidian" => $mauve
    "Kitty" => $flamingo
    _ => $text
  }
}

export def get_current_path []: string -> string {
  let filename = $"($in).nu"
  $env.FILE_PWD | path join $"plugins/" | path join $filename
}
