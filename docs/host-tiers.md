# Host Performance Tiers

A host tier is a manually assigned capability label that modules may use for
ordered feature defaults. It does not automatically inspect hardware.

The schema in `flake.nix` permits, from least to most capable:

1. `minimal`
2. `basic`
3. `standard`
4. `full`

An unset tier defaults to `standard`. Current declarations are:

| Host | Tier |
| --- | --- |
| `seiran` | `full` |
| `seiran-vm0` | `standard` |
| `seiran-vm1` | `standard` |

`modules/config/host-tier.nix` exports the shared `tiers` argument:

- `tiers.ordered`: the ordered list above
- `tiers.rank tier`: the zero-based rank
- `tiers.atLeast current minimum`: whether `current >= minimum`
- `tiers.atMost current maximum`: whether `current <= maximum`

Example:

```nix
{delib, host, tiers, ...}:
delib.module {
  name = "programs.heavy-tool";
  options = delib.singleEnableOption (tiers.atLeast host.tier "standard");
}
```

Modules must opt in explicitly to tier-aware behavior. Extend the enum only for
a demonstrated capability distinction; do not infer tiers from hardware.

Canonical sources: the schema is in `flake.nix`, comparisons are in
`modules/config/host-tier.nix`, and host values are in `hosts/*/default.nix`.
