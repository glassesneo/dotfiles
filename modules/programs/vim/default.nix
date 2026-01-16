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

  options = delib.singleEnableOption true;

  # Debug: Test if module is evaluated at all
  home.always.home.file.".vim-dpp-test".text = "Module is loaded!";

  home.ifEnabled = let
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

    # Set EDITOR environment variable (override nixvim's default)
    home.sessionVariables = {
      EDITOR = lib.mkForce "vim";
    };

    # Configure vim with dpp.vim
    programs.vim = {
      enable = true;

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
      '';
    };
  };
}
