# Regenerate the module catalogue without changing the Git index.
export def main [] {
  do --capture-errors {
    cd (^git rev-parse --show-toplevel | str trim)
    let output = ^nix build .#module-docs --no-link --print-out-paths --no-update-lock-file | str trim
    mkdir docs/generated
    open --raw $output | save --force docs/generated/modules.md
  }
}
