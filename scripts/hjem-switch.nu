def main [host: string, user?: string] {
  let selected_user = ($user | default ($env.USER? | default ""))
  if ($selected_user | is-empty) {
    error make {msg: "Specify a user or set USER"}
  }

  let flake = ($env.FILE_PWD | path dirname)
  let attribute = $'hjemConfigurations."($selected_user)@($host)"'
  let root = (mktemp -d)
  let out_link = ($root | path join preflight)
  let preflight = $'($flake)#($attribute).preflight'

  try {
    do --capture-errors { ^nix build --out-link $out_link $preflight }
    do --capture-errors { ^hjem standalone switch --flake $flake --flake-attr $attribute }
  } finally {
    rm --permanent --recursive --force $root
  }
}
