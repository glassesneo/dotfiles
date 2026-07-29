{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.skkeleton";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = boolOption parent.enable;
      skkeletonUserDictPath = readOnly (strOption "${homeConfig.xdg.dataHome}/skkeleton/jisyo");
    });

  # denops + deno come from programs.nvf.denops
  home.ifEnabled = {cfg, ...}: {
    programs.nvf.settings.vim.extraPlugins.skkeleton = {
      package = pkgs.vimPlugins.skkeleton;
      setup =
        builtins.replaceStrings
        ["@skk-dict-path@" "@user-dict-path@"]
        ["${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L" cfg.skkeletonUserDictPath]
        (builtins.readFile ./config.lua);
    };
  };
}
