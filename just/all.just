set shell := ["nu", "-c"]
export flake := justfile_directory()
export apply := justfile_directory() / 'scripts' / 'apply.nu'

# Realize every layer of HOST ($USER's Hjem, then nix-darwin) without changing any state.
build $host=`hostname -s`:
    nix build --no-link $'($env.flake)#hjemConfigurations."($env.USER)@($env.host)".preflight' $'($env.flake)#darwinConfigurations."($env.host)".system'

# Apply every layer of HOST in order, stopping at the first failure.
[arg('target', long)]
switch $host=`hostname -s` $target='':
    use {{ quote(apply) }} *; all $env.host --target $env.target
