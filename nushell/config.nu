# $env.config.edit_mode = "vi"
$env.config.show_banner = false
$env.config.buffer_editor = "nvim"
$env.bar_current_media = {}

# aliases
alias bd = cd ..
alias tree = eza --tree
alias projectroot = git rev-parse --show-toplevel

# custom completions
use ./completions/sketchybar.nu "sketchybar extern" *;
use ./completions/aerospace.nu "aerospace extern" *;
