{
  delib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    # SketchyBar integration hook scripts
    sketchybarActiveScript =
      pkgs.writeShellScript "sketchybar-claude-active"
      (builtins.readFile
        (pkgs.replaceVars ./sketchybar-active.sh {
          jq = pkgs.lib.getExe pkgs.jq;
          sketchybar = pkgs.lib.getExe pkgs.sketchybar;
        }));

    sketchybarInactiveScript =
      pkgs.writeShellScript "sketchybar-claude-inactive"
      (builtins.readFile
        (pkgs.replaceVars ./sketchybar-inactive.sh {
          sketchybar = pkgs.lib.getExe pkgs.sketchybar;
        }));
  in {
    programs.claude-code = {
      enable = true;
      package = llm-agents.claude-code;
      settings = {
        permissions = {
          allow = [
            "Skill(tmux-runner)"
            "Skill(codex-subagent)"
            "Skill(codex-exec)"
            "mcp__context7__*"
            "mcp__deepwiki__*"
            "mcp__brave-search__brave_web_search"
            "mcp__readability__*"
          ];
        };

        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = true;
          ENABLE_LSP_TOOL = true;
          CLAUDE_CODE_ENABLE_TASKS = true;
        };
        # SketchyBar integration hooks - triggers status updates on prompt submit and stop
        hooks = {
          UserPromptSubmit = [
            {
              hooks = [
                {
                  type = "command";
                  command = toString sketchybarActiveScript;
                }
              ];
            }
          ];
          Stop = [
            {
              hooks = [
                {
                  type = "command";
                  command = toString sketchybarInactiveScript;
                }
              ];
            }
          ];
        };
      };
      agents = {
        internet-research = ''
          ---
          name: internet-research
          description: Performs targeted internet research when primary planning agents have material knowledge uncertainty.
          mcpServers:
            - context7
            - deepwiki
            - brave-search
            - readability
          model: sonnet
          ---

          You are the `internet_research` subagent. Your role is targeted external knowledge retrieval for main agents.

          Tool priority (strict):
          1) `context7` for official library/framework docs and API behavior.
          2) `deepwiki` for repository-level architecture/API details.
          3) `brave-search` for broader web discovery and recency-sensitive information.
          4) `readability` for full page extraction from selected URLs.

          Research workflow:
          1) Start from the delegated research questions and known local findings.
          2) Prefer authoritative sources first; avoid redundant queries.
          3) When claims are time-sensitive, include concrete dates and staleness notes.
          4) Synthesize findings with confidence level and unresolved uncertainties.

          Required output:
          - Findings (ordered by relevance to delegated questions)
          - Sources (URL per finding)
          - Confidence and unresolved gaps
          - Recommended default assumptions for the caller when evidence is incomplete
        '';
      };
      memory.text = builtins.readFile ./GLOBAL_CLAUDE.md;
    };
  };
}
