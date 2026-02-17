{
  delib,
  lib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.ai.adapters";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = {
    plugins.codecompanion.settings.adapters = {
      http = {
        copilot.__raw = ''
          function()
            ${builtins.readFile ./adapters/copilot.lua}
          end
        '';
      };
      acp = {
        claude_code.__raw = ''
          function()
            ${builtins.readFile
            <| pkgs.replaceVars ./adapters/claude-code.lua {
              command = lib.getExe llm-agents.claude-code-acp;
            }}
          end
        '';
      };
    };
  };
}
