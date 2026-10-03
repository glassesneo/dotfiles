use std/assert

def --wrapped main [...args: string] {
  do --capture-errors {
    let command = $args.0
    $"($command)\n" | save --append .git/nix-calls
    match $command {
      fmt => {
        "formatted\n" | save --force sample.nix
        "created by hook\n" | save --force hook-new.txt
        rm --force obsolete.txt
        if ($env.FAIL_FMT? | is-not-empty) { exit 1 }
      }
      build => {
        "generated catalogue\n" | save --force .git/catalogue
        print ('.git/catalogue' | path expand)
      }
      flake => {
        ^git diff --exit-code
        let catalogue = ^git show :docs/generated/modules.md | complete
        assert equal $catalogue.exit_code 0
        assert equal $catalogue.stdout "generated catalogue\n"
        if ($env.FAIL_CHECK? | is-not-empty) { exit 1 }
      }
      _ => { error make {msg: $"Unexpected Nix command: ($command)"} }
    }
  }
}
