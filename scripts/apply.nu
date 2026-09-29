# Apply Denix configurations to this machine or, over SSH, to another host.
# Invoked by the `switch` recipes of the hjem, darwin and all just modules.

def flake-root []: nothing -> string {
  const root = path self | path dirname | path dirname
  return $root
}

# Where HOST is applied: null for this machine, otherwise an SSH destination.
# An explicit --target wins; otherwise only this machine can be applied.
def resolve-target [host: string, target: string]: nothing -> any {
  if ($target | is-not-empty) { return $target }
  if $host == (^hostname -s | str trim) { return null }
  error make {msg: $"($host) is not this machine; pass --target"}
}

def run-on [target: any, command: string] {
  if $target == null {
    ^sh -c $command
  } else {
    ^ssh -t $target $command
  }
}

# Realize ATTR and keep it alive under ROOT until the procedure finishes.
def realize [attr: string, root: string]: nothing -> string {
  ^nix build --print-out-paths --out-link $root $attr | lines | first
}

def push [target: string, ...paths: string] {
  ^nix copy --no-check-sigs --to $'ssh-ng://($target)' ...$paths
}

def apply-hjem [host: string, target: any, roots: string] {
  let root = flake-root
  let user = if $target == null { $env.USER } else { ^ssh $target whoami | str trim }
  let attr = $'hjemConfigurations."($user)@($host)"'

  let preflight = realize $'($root)#($attr).preflight' ($roots | path join hjem-preflight)
  let hjem = realize $'($root)#hjem' ($roots | path join hjem-cli)
  let source = ^nix flake metadata --json $root | from json | get path

  if $target != null {
    push $target $preflight $hjem
    ^nix flake archive --to $'ssh-ng://($target)' $root
  }

  run-on $target $"($hjem)/bin/hjem standalone switch --flake ($source) --flake-attr '($attr)'"
}

def apply-darwin [host: string, target: any, roots: string] {
  let system = realize $'(flake-root)#darwinConfigurations."($host)".system' ($roots | path join darwin-system)

  if $target != null {
    push $target $system
  }

  run-on $target $"sudo ($system)/sw/bin/nix-env -p /nix/var/nix/profiles/system --set ($system) && sudo ($system)/activate"
}

# Hold temporary GC roots for everything realized by ACTION, then drop them.
def with-roots [action: closure] {
  let roots = mktemp -d
  try {
    do $action $roots
  } finally {
    rm --permanent --recursive --force $roots
  }
}

# Apply the Hjem configuration of the local user, or of the SSH user on a remote host.
export def hjem [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-hjem $host $target $roots }
}

# Activate the nix-darwin system of HOST.
export def darwin [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots| apply-darwin $host $target $roots }
}

# Apply Hjem, then nix-darwin; a failure stops before the next layer.
export def all [host: string, --target: string = ""] {
  let target = resolve-target $host $target
  with-roots {|roots|
    apply-hjem $host $target $roots
    apply-darwin $host $target $roots
  }
}
