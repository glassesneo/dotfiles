system := `nix eval --impure --raw --expr builtins.currentSystem`

# Build or apply the standalone Hjem configuration: just hjem <build|switch> [host]
mod hjem 'just/hjem.just'

# Build or apply the nix-darwin configuration: just darwin <build|switch> [host]
mod darwin 'just/darwin.just'

# Build or apply every layer of a host in order: just all <build|switch> [host]
mod all 'just/all.just'

fmt:
    nix fmt

docs:
    nu --no-config-file scripts/docs.nu

eval:
    nix flake check --no-build --no-update-lock-file

check name:
    nix build --no-link ".#checks.{{system}}.{{name}}"
