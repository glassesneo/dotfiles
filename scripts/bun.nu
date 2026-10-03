# Change the dependencies of one Bun project and regenerate its bun.nix.
#
# A project is the directory of the given package.json. Every operation runs
# Bun there, then rewrites bun.nix from bun.lock, so bun.nix only changes
# through these commands. `bun` and `bun2nix` come from the development shell.

def project [manifest: path]: nothing -> path {
  let manifest = $manifest | path expand
  if ($manifest | path basename) != "package.json" or not ($manifest | path exists) {
    error make {msg: $"expected an existing package.json, got ($manifest)"}
  }
  $manifest | path dirname
}

def regenerate [dir: path] {
  cd $dir
  ^bun2nix --lock-file bun.lock --output-file bun.nix
}

def run-bun [manifest: path, args: list<string>] {
  let dir = project $manifest
  do {
    cd $dir
    ^bun ...$args
  }
  regenerate $dir
}

def main [] {
  help main
}

# Add PACKAGES to the project of MANIFEST.
def --wrapped "main add" [manifest: path, ...packages: string] {
  run-bun $manifest ["add" ...$packages]
}

# Remove PACKAGES from the project of MANIFEST.
def --wrapped "main remove" [manifest: path, ...packages: string] {
  run-bun $manifest ["remove" ...$packages]
}

# Update PACKAGES, or every dependency when none is given, within package.json ranges.
def --wrapped "main update" [manifest: path, ...packages: string] {
  run-bun $manifest ["update" ...$packages]
}

# Install after editing package.json by hand.
def "main sync" [manifest: path] {
  run-bun $manifest ["install"]
}

export alias add = main add
export alias remove = main remove
export alias update = main update
export alias sync = main sync
