# Package names are passed as separate arguments, which Nushell's `-c` cannot
# receive, so these recipes run under sh and forward them with "$@".
set shell := ["sh", "-cu"]
set positional-arguments
export bun := justfile_directory() / 'scripts' / 'bun.nu'

# Add PACKAGES to the Bun project of MANIFEST and regenerate its bun.nix.
[no-cd]
add manifest +packages:
  nu --no-config-file "$bun" add "$@"

# Remove PACKAGES from the Bun project of MANIFEST and regenerate its bun.nix.
[no-cd]
remove manifest +packages:
  nu --no-config-file "$bun" remove "$@"

# Update PACKAGES (default: all) of the Bun project of MANIFEST and regenerate its bun.nix.
[no-cd]
update manifest *packages:
  nu --no-config-file "$bun" update "$@"

# Install the Bun project of MANIFEST after a manual package.json edit and regenerate its bun.nix.
[no-cd]
sync manifest:
  nu --no-config-file "$bun" sync "$@"
