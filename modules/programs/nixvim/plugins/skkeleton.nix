{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.skkeleton";

  options = delib.singleEnableOption true;

  # deno runtime is provided by denops.nix
  home.ifEnabled.programs.nixvim = {
    extraPlugins = [pkgs.vimPlugins.skkeleton];
    extraConfigLua =
      lib.replaceStrings
      ["@skk-dict-path@" "@user-dict-path@"]
      [
        "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L"
        "${homeConfig.xdg.configHome}/.skkeleton"
      ]
      (builtins.readFile ./skkeleton.lua);
  };
}
