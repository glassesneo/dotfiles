zstyle :prompt:pure:git:stash show yes
autoload -U promptinit
promptinit
prompt pure
prompt_pure_async_git_stash() {
  local count
  count=$(command git rev-list --walk-reflogs --count refs/stash 2>/dev/null) || return
  ((count > 0)) && print -r -- "$count"
}
