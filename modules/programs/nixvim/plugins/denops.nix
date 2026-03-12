{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.denops";

  options = delib.singleEnableOption true;

  # Shared denops runtime for all denops-backed Neovim plugins.
  # The overlay plugins (kensaku, fuzzy-motion, etc.) carry denops-vim as a
  # transitive dependency, but pkgs.deno must be explicitly provided on PATH
  # because nixvim does not unwrap passthru runtimeDeps from plugin metadata.
  home.ifEnabled.programs.nixvim = {
    extraPlugins = [pkgs.vimPlugins.denops-vim];
    extraPackages = [pkgs.deno];
  };
}
