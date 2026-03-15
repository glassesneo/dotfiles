#!/usr/bin/env nu
use ./colors.nu

export def icon_color (): string -> string {
  match $in {
    "Arc" => $colors.app_arc
    "Ghostty" => $colors.app_ghostty
    "Obsidian" => $colors.app_obsidian
    "Kitty" => $colors.app_kitty
    _ => $colors.text_primary
  }
}

export def get_current_path []: string -> string {
  let filename = $"($in).nu"
  $env.FILE_PWD | path join $"plugins/" | path join $filename
}
