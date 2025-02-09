# aliases
alias bd = cd ..
alias tree = eza --tree
alias projectroot = git rev-parse --show-toplevel

# starship
mkdir ($nu.data-dir | path join "vendor/autoload")
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
