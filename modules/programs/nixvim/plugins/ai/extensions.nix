{
  delib,
  host,
  inputs,
  lib,
  pkgs,
  ...
}: let
  mcphub-nvim = inputs.mcphub-nvim.packages."${host.homeManagerSystem}".default;
in
  delib.module {
    name = "programs.nixvim.plugins.ai.extensions";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled.programs.nixvim = {
      plugins.codecompanion.settings = {
        extensions = {
          history = {
            enabled = true;
            opts = {
              auto_generate_title = true;
              title_generation_opts = {
                adapter = "copilot";
                model = "gpt-5-mini";
              };
            };
          };
          mcphub = {
            callback = "mcphub.extensions.codecompanion";
            opts = {
              show_result_in_chat = true;
              make_vars = true;
              make_slash_commands = true;
              requires_approval = true;
            };
          };
        };
        opts = {
          log_level = "TRACE";
        };
      };
      extraPlugins = [
        {
          plugin = pkgs.vimPlugins.codecompanion-history-nvim;
          optional = true;
        }
        mcphub-nvim
      ];

      # Load state module before codecompanion (provides _G.CCWorkflowState)
      extraConfigLuaPre = builtins.readFile ./workflows/state.lua;

      extraConfigLua = ''
        require('lz.n').load({{
          'codecompanion-history.nvim',
        }})
      '';
    };
  }

