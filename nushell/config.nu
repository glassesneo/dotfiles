# $env.config.edit_mode = "vi"
$env.config.show_banner = false
$env.config.rm.always_trash = true
$env.config.buffer_editor = "nvim"

# aliases
alias bd = cd ..
alias tree = eza --tree
alias projectroot = git rev-parse --show-toplevel

# starship
mkdir ($nu.data-dir | path join "vendor/autoload")
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
