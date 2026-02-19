{
  config,
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.dpp";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    dppShared = config.myconfig.args.shared.dppShared;
    dpp-plugins = dppShared.dppPluginPkgs;
    dpp-rtp-config =
      lib.strings.concatMapStrings (plugin: ''
        vim.opt.runtimepath:prepend("${plugin}")
      '')
      dpp-plugins;
  in {
    # TODO(stabilization-window): Keep legacy artifacts for rollback safety.
    # Deletion is deferred to a follow-up after stability sign-off.
    # Pending cleanup targets:
    # - modules/programs/vim/plugins/skk.toml
    xdg.configFile = {
      "dpp/dpp.ts" = {
        source = pkgs.replaceVars ./dpp.ts {
          plugin-dir-path = "${homeConfig.xdg.configHome}/dpp/plugins";
        };
      };
      "dpp/plugins" = {
        source = dppShared.pluginTomls;
      };
      "dpp/hooks/skk.vim" = {
        source = pkgs.replaceVars dppShared.sharedHookSources.skkVim {
          skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
        };
      };
    };
    programs.nixvim = {
      env = {
        DPP_HOOK_DIR = "${homeConfig.xdg.configHome}/dpp/hooks";
      };
      extraPlugins = [pkgs.vimPlugins.denops-vim];
      extraConfigLuaPre = dpp-rtp-config + builtins.readFile ./setup-dpp.lua;
    };
  };
}
