{
  delib,
  host,
  inputs,
  lib,
  # pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim";

  options.programs.nixvim = with delib; {
    enable = boolOption host.devCoreFeatured;

    defaultEditor = boolOption true;
    appearance = {
      theme = lib.mkOption {
        type = lib.types.enum ["catppuccin" "everforest" "base16"];
        default = "base16";
      };
      catppuccin-flavor = lib.mkOption {
        type = lib.types.enum ["latte" "frappe" "macchiato" "mocha"];
        default = "macchiato";
      };
      everforest-background = lib.mkOption {
        type = lib.types.enum ["hard" "medium" "soft"];
        default = "medium";
      };
      transparent = boolOption false;
      rounded-borders = boolOption false;
      comment-color = strOption "";
      transparent-floats = boolOption false;
    };
  };

  myconfig.always.args.shared.nixvimLib = inputs.nixvim.lib;

  home.always.imports = [inputs.nixvim.homeModules.nixvim];

  home.ifEnabled = {cfg, ...}: {
    programs.nixvim = {
      enable = true;
      # package = inputs.neovim-nightly-overlay.packages.${pkgs.stdenv.hostPlatform.system}.default;
      inherit (cfg) defaultEditor;
      withNodeJs = false;
      withPerl = false;
      withPython3 = false;
      withRuby = false;
      wrapRc = false;
      autoCmd = [
        {
          event = "TextYankPost";
          pattern = ["*"];
          callback.__raw = ''
            function()
              vim.hl.on_yank({ timeout = 300 })
            end
          '';
        }
      ];
    };

    home.sessionVariables = {
      EDITOR = "nvim";
      VISUAL = "nvim";
    };
  };
}
