{
  delib,
  host,
  inputs,
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
        gemini.__raw = ''
          function()
            ${builtins.readFile ./adapters/gemini.lua}
          end
        '';
        ollama.__raw = ''
          function()
            ${builtins.readFile ./adapters/ollama.lua}
          end
        '';
        cerebras.__raw = ''
          function()
            ${builtins.readFile ./adapters/cerebras.lua}
          end
        '';
        io-intelligence.__raw = ''
          function()
            ${builtins.readFile ./adapters/io-intelligence.lua}
          end
        '';
        ai-mop-openai.__raw = ''
          function()
            ${builtins.readFile ./adapters/ai-mop-openai.lua}
          end
        '';
        ai-mop-anthropic.__raw = ''
          function()
            ${builtins.readFile ./adapters/ai-mop-anthropic.lua}
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
        gemini_cli.__raw = ''
          function()
            ${builtins.readFile ./adapters/gemini-cli.lua}
          end
        '';
      };
    };
  };
}
