# $env.config.edit_mode = "vi"
$env.config.show_banner = false
$env.config.buffer_editor = "nvim"
$env.config.completions.case_sensitive = true

# aliases
alias bd = cd ..
alias tree = eza --tree
alias projectroot = git rev-parse --show-toplevel

# custom completions
use ./completions/sketchybar.nu "sketchybar extern" *;
use ./completions/aerospace.nu "aerospace extern" *;
