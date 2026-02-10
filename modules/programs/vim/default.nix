{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.myvimeditor";

  options.programs.myvimeditor = with delib; {
    enable = boolOption true;
    # Rice-aware colorscheme configuration
    colorscheme = {
      plugin = strOption ""; # e.g., "catppuccin-vim", "base16-vim"
      config = strOption ""; # Extra vimscript config for the colorscheme
    };
  };

  # Debug: Test if module is evaluated at all
  home.always.home.file.".vim-dpp-test".text = "Module is loaded!";

  home.ifEnabled = {cfg, ...}: let
    # Build dpp plugins from flake inputs
    dpp-plugins =
      inputs
      |> lib.attrsets.getAttrs [
        "dpp-vim"
        "dpp-ext-installer"
        "dpp-ext-lazy"
        "dpp-ext-toml"
        "dpp-protocol-git"
      ]
      |> lib.attrsets.mapAttrsToList (name: src:
        pkgs.vimUtils.buildVimPlugin {
          inherit name src;
          dependencies = [pkgs.vimPlugins.denops-vim];
        });

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
          "vim colorscheme.config is set but colorscheme.plugin is empty - the colorscheme won't be available";
        [pkgs.vimPlugins.${cfg.colorscheme.plugin}]
      else [];
  in {
    # Deploy vim-specific dpp configuration files
    xdg.configFile = {
      "vim-dpp/dpp.ts" = {
        source = pkgs.replaceVars ./dpp.ts {
          plugin-dir-path = "${homeConfig.xdg.configHome}/vim-dpp/plugins";
        };
      };
      "vim-dpp/plugins" = {
        source = ./plugins;
      };
      "vim-dpp/hooks/skk.vim" = {
        source = pkgs.replaceVars ./hooks/skk.vim {
          skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
        };
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
