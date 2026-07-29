{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.denops";

  options = delib.singleCascadeEnableOption;

  # Shared denops runtime for denops-backed Neovim plugins.
  # Must be a start plugin (not lazy): denops discovers plugins from
  # runtimepath on DenopsReady.
  home.ifEnabled.programs.nvf.settings.vim = {
    startPlugins = [pkgs.vimPlugins.denops-vim];
    extraPackages = [pkgs.deno];
  };
}
