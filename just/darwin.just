set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Realize the nix-darwin system of HOST without changing any state.
build $host=`hostname -s`:
  nix build --no-link $'($env.flake)#darwinConfigurations."($env.host)".system'

# Activate the nix-darwin system on HOST: this machine, or --target over SSH.
[arg('target', long)]
switch $host=`hostname -s` $target='':
  use {{ quote(apply) }} *; darwin $env.host --target $env.target
