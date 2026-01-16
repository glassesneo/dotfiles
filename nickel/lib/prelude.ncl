# Common contracts and helpers used across Nickel configurations
{
  # Contract for a valid hex color
  HexColor =
    std.contract.from_predicate (fun value =>
      std.string.is_match "^#[0-9a-fA-F]{6}$" value
    ),

  # Contract for a valid npm package name (scoped or unscoped)
  NpmPackage =
    std.contract.from_predicate (fun value =>
      std.string.is_match "^@[a-z0-9-]+/[a-z0-9-]+$" value
      || std.string.is_match "^[a-z0-9-]+$" value
    ),

  # Helper: create a color pair with same dark/light value
  same = fun c => { dark = c, light = c },

  # Helper: "none" for transparent backgrounds
  none = { dark = "none", light = "none" },
}
