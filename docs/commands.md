# Commands

This file owns the operator commands: what each one realizes or changes, and how it fails.

## Boundary

Nix owns evaluation and realization. Build recipes call Nix directly and do not modify user or system state. Effectful procedures belong in Nushell under `scripts/` and are invoked through `justfile`.

## Layers and operations

Operator commands follow `just <layer> <operation> [host]`. Each layer is a `just` module under `just/`: `hjem` and `darwin` address one module system, and `all` applies every layer of the host in order. The operations are `build` and `switch`.

- `build` realizes the layer without touching any state: Hjem's `preflight` derivation for `$USER`, the nix-darwin `system`, or both for `all`.
- `switch` delegates to `scripts/apply.nu`, which holds temporary GC roots for everything it realizes and removes them when it exits.
- `all switch` applies nix-darwin before Hjem and stops at the first failure.

## Targets

An omitted host means this machine, resolved with `hostname -s`; the `host` module keeps the system name equal to the Denix host name. `switch` applies to `--target` over SSH when it is given, and locally when the host is this machine; any other host without `--target` is an error. Hosts carry no SSH destinations, so one configuration can be applied to any machine that accepts it. A remote switch builds everything locally, copies the closures and the flake source over `ssh-ng` without signature checks, and activates over SSH. Hjem is applied for the SSH user there and for `$USER` locally.

## Failure

A Hjem preflight failure occurs after nix-darwin activation during `all switch`, but before Hjem activation, and leaves the existing home unchanged. Hjem activation itself is not transactional; a failure during activation may leave partial changes. Snapshots of virtual machines are outside this interface.
