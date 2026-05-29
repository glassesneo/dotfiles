{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.skkeleton";

  options.programs.nixvim.plugins.skkeleton = with delib; {
    enable = boolOption true;
    skkeletonUserDictPath = readOnly (strOption "${homeConfig.xdg.dataHome}/skkeleton/jisyo");
  };

  # deno runtime is provided by denops.nix
  home.ifEnabled = {cfg, ...}: {
    programs.nixvim = {
      extraPlugins = [pkgs.vimPlugins.skkeleton];
      extraConfigLua =
        builtins.replaceStrings
        ["@skk-dict-path@" "@user-dict-path@"]
        ["${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L" cfg.skkeletonUserDictPath]
        (builtins.readFile ./config.lua);
    };
  };
}
