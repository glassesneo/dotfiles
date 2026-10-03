use std/assert

def --wrapped git [...args: string]: nothing -> string {
  let result = ^git ...$args | complete
  if $result.exit_code != 0 {
    error make {msg: $"git ($args | str join ' ') failed: ($result.stdout)($result.stderr)"}
  }
  $result.stdout
}

def with-repo [hooks: string, action: closure] {
  let previous = $env.PWD
  let directory = mktemp -d
  try {
    cd $directory
    git init -q | ignore
    git config user.email test@example.invalid | ignore
    git config user.name Test | ignore
    "original\n" | save sample.nix
    "obsolete\n" | save obsolete.txt
    "ignored\n" | save .gitignore
    git add . | ignore
    git commit -qm initial | ignore
    git config core.hooksPath $hooks | ignore
    "needs formatting\n" | save --force sample.nix
    git add sample.nix | ignore
    do $action
  } finally {
    cd $previous
    rm --recursive --force $directory
  }
}

def main [hooks: string] {
  for dirty in [unstaged untracked] {
    with-repo $hooks {
      if $dirty == unstaged {
        "keep this unstaged edit\n" | save --force sample.nix
      } else {
        "keep this new file\n" | save untracked
      }
      let before_index = git write-tree
      let before_status = git status --porcelain
      let before_diff = git diff
      let result = ^git commit -m blocked | complete
      assert ($result.exit_code != 0)
      assert (($result.stdout + $result.stderr | str lowercase) | str contains $dirty)
      assert equal (git write-tree) $before_index
      assert equal (git status --porcelain) $before_status
      assert equal (git diff) $before_diff
      assert (not ('.git/nix-calls' | path exists))
    }
  }

  for fail_check in [false true] {
    with-repo $hooks {
      "not part of the commit\n" | save ignored
      "already staged\n" | save user-change.txt
      git add user-change.txt | ignore
      let before_head = git rev-parse HEAD
      let result = with-env {FAIL_CHECK: (if $fail_check { "1" } else { "" })} {
        ^git commit -m automated | complete
      }
      let output = $result.stdout + $result.stderr
      assert equal ($result.exit_code != 0) $fail_check $output
      assert equal (open --raw .git/nix-calls) "fmt\nbuild\nflake\n"
      assert ($output | str contains sample.nix)
      assert ($output | str contains hook-new.txt)
      assert (not ($output | lines | any {|line|
        ($line | str contains user-change.txt) and ($line | str contains '|')
      }))
      assert equal (git show :sample.nix) "formatted\n"
      assert equal (git show :docs/generated/modules.md) "generated catalogue\n"
      assert equal (git show :hook-new.txt) "created by hook\n"
      assert equal (git ls-files obsolete.txt ignored) ""
      assert equal (git diff) ""
      if $fail_check {
        assert equal (git rev-parse HEAD) $before_head
        assert (git diff --cached --name-only | is-not-empty)
      } else {
        assert equal (git status --porcelain) ""
        assert equal (git show HEAD:docs/generated/modules.md) "generated catalogue\n"
      }
    }
  }

  with-repo $hooks {
    let result = with-env {FAIL_FMT: "1"} {
      ^git commit -m 'format failure' | complete
    }
    assert ($result.exit_code != 0)
    assert equal (open --raw .git/nix-calls) "fmt\n"
    assert equal (open --raw sample.nix) "formatted\n"
    assert equal (git show :sample.nix) "needs formatting\n"
  }
}
