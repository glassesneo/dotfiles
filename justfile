system := `nix eval --impure --raw --expr builtins.currentSystem`

fmt:
    nix fmt

eval:
    nix flake check --no-build --no-update-lock-file

check name:
    nix build --no-link ".#checks.{{system}}.{{name}}"

build-hjem host user=env_var('USER'):
    nix build --no-link {{quote('.#hjemConfigurations."' + user + '@' + host + '".preflight')}}

switch-hjem host user=env_var('USER'):
    nu scripts/hjem-switch.nu {{quote(host)}} {{quote(user)}}
