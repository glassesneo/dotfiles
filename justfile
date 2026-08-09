system := `nix eval --impure --raw --expr builtins.currentSystem`

fmt:
    nix fmt

eval:
    nix flake check --no-build --no-update-lock-file

check flake_check_name:
    nix build --no-link ".#checks.{{system}}.{{flake_check_name}}"

full:
    nix run .#check-full
