{
  delib,
  host,
  inputs,
  ...
}:
delib.module {
  name = "programs.nixvim";

  options = with delib;
    moduleOptions {
      enable = boolOption host.devCoreFeatured;

      defaultEditor = boolOption true;
      appearance = {
        theme = enumOption ["catppuccin" "everforest" "base16"] "base16";
        catppuccin-flavor = enumOption ["latte" "frappe" "macchiato" "mocha"] "macchiato";
        everforest-background = enumOption ["hard" "medium" "soft"] "medium";
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
      # Keep nixvim on the repository's nixpkgs intentionally and make that
      # choice explicit so nixvim does not warn about a default changed by
      # flake input following.
      nixpkgs.source = inputs.nixpkgs;

      # Nixvim's current manpage builder requires Pandoc Lua support, which the
      # followed Nixpkgs revision's minimal pandoc package does not provide.
      enableMan = false;
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
