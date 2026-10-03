# Owns the commit transaction: reject pre-existing work, fix, stage, then check.
# Failure leaves completed fixes in place; check failure leaves them staged.
use ./docs.nu

def main [] {
  do --capture-errors {
    cd (^git rev-parse --show-toplevel | str trim)
    let dirty = ^git diff --quiet --ignore-submodules=none | complete
    if $dirty.exit_code != 0 {
      error make {msg: "Unstaged changes: stage or stash them before committing."}
    }
    if (^git ls-files --others --exclude-standard -z | is-not-empty) {
      error make {msg: "Untracked files: stage, ignore, or move them before committing."}
    }

    let before = ^git write-tree | str trim
    ^nix fmt --no-update-lock-file
    docs
    ^git add --all
    ^git --no-pager diff --cached --stat $before --
    ^nix flake check --no-update-lock-file
  }
}
