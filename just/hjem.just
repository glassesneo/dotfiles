set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Realize the Hjem configuration of $USER on HOST without changing any state.
build $host=`hostname -s`:
  nix build --no-link $'($env.flake)#hjemConfigurations."($env.USER)@($env.host)".preflight'

# Apply the Hjem configuration to HOST: this machine, or --target over SSH.
[arg('target', long)]
switch $host=`hostname -s` $target='':
  use {{ quote(apply) }} *; hjem $env.host --target $env.target
