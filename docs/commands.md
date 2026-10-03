# Commands

This file owns the operator commands: what each one realizes or changes, and how it fails.

## Boundary

Nix owns evaluation and realization. Build recipes call Nix directly and do not modify user or system state. Operator procedures and external-command orchestration default to Nushell under `scripts/` and are invoked through `justfile`. Internal runtime implementations may use another language for a concrete standard-library or safety benefit, with the reason documented near the implementation.

## Formatting, documentation, and checks

- `just fmt` runs `nix fmt` over the repository using treefmt.
- `just docs` regenerates `docs/generated/modules.md` without staging it. The catalogue includes all modules, regardless of host enablement, sorted by Denix name. Descriptions are taken from `meta.description` without translation or summarization; source links use declaration paths. It contains no generation timestamp.
- `just eval` evaluates the flake checks without building or updating the lock file.
- `just check <name>` builds one check for the current system.
- `nix flake check` runs all checks, including formatting and catalogue freshness. Checks do not rewrite repository files.

## Bun dependencies

A Bun project is the directory of a `package.json`. Its npm dependencies reach Nix only through the `bun.nix` that bun2nix generates from its `bun.lock`.

- `just bun <add|remove|update|sync> <package.json> [packages]` runs the matching Bun command in that project, then rewrites its `bun.nix` with the unformatted output of bun2nix; `nix fmt` excludes every `bun.nix`. `sync` runs `bun install` after a manual `package.json` edit. Arguments after the manifest, flags included, pass through to Bun; a relative manifest resolves against the invoking directory.
- These commands need `bun` and `bun2nix` from the development shell and reach the npm registry. They create the Git-ignored `node_modules` in the project and change no other state.
- `package.json` carries no lifecycle script that regenerates `bun.nix`. Changing the lock with Bun directly leaves `bun.nix` stale, and the `bun-lock` check, run by `nix flake check`, fails until `just bun sync` is run.

## Commit automation

Entering `nix develop`, or entering through an allowed direnv environment, installs the git-hooks.nix runner and sets this repository's `core.hooksPath`. Installation replaces the configured hooks path; existing hooks are not chained. The installed tools are GC-rooted in the Git common directory. A fresh clone has no hooks until the development shell has been entered; re-enter it after changing the hook configuration or scripts. Hooks then also work outside the development shell, with access to Nix and its daemon still required.

Before any mutation, the hook rejects unstaged tracked changes and untracked files; Git-ignored files are excluded. Stage, stash, ignore, or move these files first. Partial staging is therefore not supported. Do not edit the worktree or index concurrently with a commit.

The hook runs repository-wide formatting and catalogue generation, stages all resulting non-ignored additions, modifications, and deletions, and displays a `git diff --stat` summary of only those automatic changes. It then runs `nix flake check`. Successful checks allow the commit without another confirmation. Lock-file updates are disabled throughout this sequence.

Check failure blocks the commit and leaves automatic changes staged. Formatting or generation failure stops immediately and leaves any completed edits in the worktree without automatically staging them. Interrupted execution does not roll changes back; inspect `git status` before retrying. Git's `--no-verify` bypass remains available, and checks can still be run manually. The stateful commit runner is not itself a flake check: sandboxed checks cannot invoke nested Nix builds, and doing so would recurse.

## Layers and operations

Commands that build or apply a configuration follow `just <layer> <operation> [host]`. Each layer is a `just` module under `just/`: `hjem` and `darwin` address one module system, and `all` applies every layer of the host in order. The operations are `build` and `switch`.

- `build` realizes the layer without touching any state: Hjem's `preflight` derivation for `$USER`, the nix-darwin `system`, or both for `all`.
- `switch` delegates to `scripts/apply.nu`, which holds temporary GC roots for everything it realizes and removes them when it exits.
- `all switch` applies nix-darwin before Hjem and stops at the first failure.
- Hjem switch applies files/packages with standalone, then reconciles Hjem-owned
  user services as the same target user. Calling upstream standalone directly
  does not update services. Service generations have persistent per-user GC roots
  under `.local/state/hjem/services` in the configured home, beyond temporary build roots.
  LaunchAgent files are owned copies, not store symlinks. Modified or unmanaged
  files/jobs are rejected; remove declarations to retire managed jobs.
- GUI absence defers live service operations until another switch; manual
  launchctl disable is respected. Successful switch means registration/start
  requests succeeded, not application readiness. Background services are not
  guaranteed to return after reboot. Linux service declarations currently fail
  evaluation rather than silently doing nothing. Darwin-native declarations
  are ignored on non-Darwin systems; an empty service apply there is a no-op.

## Targets

An omitted host means this machine, resolved with `hostname -s`; the `host` module keeps the system name equal to the Denix host name. `switch` applies to `--target` over SSH when it is given, and locally when the host is this machine; any other host without `--target` is an error. Hosts carry no SSH destinations, so one configuration can be applied to any machine that accepts it. A remote switch builds everything locally, copies the closures and the flake source over `ssh-ng` without signature checks, and activates over SSH. Hjem is applied for the SSH user there and for `$USER` locally.

## Failure

A Hjem preflight failure occurs after nix-darwin activation during `all switch`, but before Hjem activation, and leaves the existing home unchanged. Hjem activation itself is not transactional; a failure during activation may leave partial changes. Service failure is also nontransactional: earlier changes remain, ownership state and closure roots survive, and the next switch retries. Do not manually edit managed plists or the service journal. Snapshots of virtual machines are outside this interface.
