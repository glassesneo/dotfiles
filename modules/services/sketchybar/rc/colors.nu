#!/usr/bin/env nu
# Color values are substituted by Nix at build time via pkgs.replaceVars
# Semantic color palette for SketchyBar items and UI elements

# Bar and text colors
export const bar_background = "@bar_background@"
export const text_primary = "@text_primary@"
export const text_muted = "@text_muted@"

# Workspace colors
export const workspace_active = "@workspace_active@"

# Surface and popup colors
export const surface_background = "@surface_background@"
export const popup_background = "@popup_background@"
export const popup_border = "@popup_border@"

# Accent colors
export const accent_datetime = "@accent_datetime@"

# Status colors
export const status_error = "@status_error@"
export const status_warning = "@status_warning@"
export const status_caution = "@status_caution@"
export const status_success = "@status_success@"
export const status_charging = "@status_charging@"

# App-specific icon colors
export const app_arc = "@app_arc@"
export const app_ghostty = "@app_ghostty@"
export const app_obsidian = "@app_obsidian@"
export const app_kitty = "@app_kitty@"

# CPU graph colors by usage level
export const cpu_low = "@cpu_low@"
export const cpu_medium = "@cpu_medium@"
export const cpu_high = "@cpu_high@"
export const cpu_critical = "@cpu_critical@"
