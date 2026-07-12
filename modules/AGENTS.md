# modules/

`docs/denix-architecture.md` is the canonical contract for module ownership,
Denix discovery, aggregation, and splitting decisions.

## Module-Local Invariants

- Use `home.ifEnabled` for Home Manager output so standalone Home Manager and nix-darwin configurations target the correct configuration root.
- Export cross-module values through `myconfig.always.args.shared`; do not read another feature's options directly when a narrow capability or data contract suffices.
- Use `delib.host` for host-scoped module behavior rather than embedding host selection in reusable features.
