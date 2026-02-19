{
  delib,
  dppShared,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.vim";

  options.programs.vim = with delib; {
    enable = boolOption true;
    # Rice-aware colorscheme configuration
    colorscheme = {
      plugin = strOption ""; # e.g., "catppuccin-vim", "base16-vim"
      config = strOption ""; # Extra vimscript config for the colorscheme
    };
  };

  home.ifEnabled = {cfg, ...}: let
    dpp-plugins = dppShared.dppPluginPkgs;

    # Generate Vimscript runtimepath config
    dpp-rtp-config =
      lib.strings.concatMapStrings (plugin: ''
        execute 'set runtimepath^=' . '${plugin}'
      '')
      dpp-plugins;

    # Validate plugin name if specified
    pluginExists = cfg.colorscheme.plugin == "" || pkgs.vimPlugins ? ${cfg.colorscheme.plugin};

    # Validate: config without plugin is likely a mistake
    configWithoutPlugin = cfg.colorscheme.config != "" && cfg.colorscheme.plugin == "";

    # Conditionally build colorscheme plugin from option (with validation)
    colorschemePlugin =
      if cfg.colorscheme.plugin != ""
      then
        assert lib.assertMsg pluginExists
        "vim colorscheme plugin '${cfg.colorscheme.plugin}' not found in pkgs.vimPlugins";
        assert lib.assertMsg (!configWithoutPlugin)
        "vim colorscheme.config is set but colorscheme.plugin is empty - the colorscheme won't be available"; [pkgs.vimPlugins.${cfg.colorscheme.plugin}]
      else [];
  in {
    # TODO(stabilization-window): Keep legacy artifacts for rollback safety.
    # Deletion is deferred to a follow-up after stability sign-off.
    # Pending cleanup targets:
    # - modules/programs/vim/plugins/skk.toml
    # Deploy vim-specific dpp configuration files
    xdg.configFile = {
      "vim-dpp/dpp.ts" = {
        source = pkgs.replaceVars ./dpp.ts {
          plugin-dir-path = "${homeConfig.xdg.configHome}/vim-dpp/plugins";
        };
      };
      "vim-dpp/plugins" = {
        source = dppShared.pluginTomls;
      };
      "vim-dpp/hooks/skk.vim" = {
        source = pkgs.replaceVars dppShared.sharedHookSources.skkVim {
          skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
        };
      };
      "vim-dpp/ddc.ts" = {
        source = ./ddc.ts;
      };
      "vim-dpp/hooks/ddc.vim" = {
        source = ./ddc-hook.vim;
      };
      "vim-dpp/hooks/vim-lsp.vim" = {
        source = ./vim-lsp-hook.vim;
      };
    };

    # EDITOR defaults to nvim via nixvim (no vim override needed)
    # vim remains available as explicit command

    # Configure vim with dpp.vim
    programs.vim = {
      enable = true;

      # Add colorscheme plugin from rice options
      plugins = colorschemePlugin;

      # Load main vim configuration
      extraConfig = ''
        " Load base vimrc configuration
        ${builtins.readFile ./.vimrc}

        " DPP environment
        let $DPP_HOOK_DIR = '${homeConfig.xdg.configHome}/vim-dpp/hooks'

        " Prepend dpp plugins and denops to runtimepath
        execute 'set runtimepath^=' . '${pkgs.vimPlugins.denops-vim}'
        ${dpp-rtp-config}

        " Load dpp setup
        ${builtins.readFile ./setup-dpp.vim}

        " Rice colorscheme configuration
        ${cfg.colorscheme.config}
      '';
    };
  };
}
