{...}: {
  projectRootFile = "flake.nix";

  programs.alejandra.enable = true;
  programs.stylua.enable = true;
  programs.shfmt.enable = true;

  # Preserve current 2-space indentation behavior for Lua files.
  settings.formatter.stylua.options = [
    "--indent-type"
    "Spaces"
    "--indent-width"
    "2"
  ];

  settings.global.excludes = [
    "node-packages/bun.nix"
  ];
}
