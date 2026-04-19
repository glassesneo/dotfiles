{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.copilot";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = let
    copilotPkgs = import pkgs.path {
      inherit (pkgs.stdenv.hostPlatform) system;
      config.allowUnfree = true;
    };
  in {
    extraPackages = [
      copilotPkgs.copilot-language-server
    ];

    extraPlugins = [
      {
        plugin = pkgs.vimPlugins.copilot-lua;
        optional = true;
      }
    ];

    extraConfigLua = ''
      local copilot_opts = (function()
      ${builtins.readFile ./copilot-lsp.lua}
      end)()

      require('lz.n').load({{
        'copilot.lua',
        cmd = {"Copilot"},
        event = {"BufReadPost", "BufNewFile", "InsertEnter"},
        after = function()
          require('copilot').setup(copilot_opts)
        end,
      }})
    '';
  };
}
