$env.PATH = (
  $env.PATH
  | split row (char esep)
  | prepend '/opt/homebrew/bin'
  | prepend '/nix/var/nix/profiles/default/bin'
  | prepend ('/etc/profiles/per-user/' + $env.USER + '/bin')
  | prepend '/run/current-system/sw/bin'
  | uniq
)
