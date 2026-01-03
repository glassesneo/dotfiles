{
  delib,
  inputs,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.claude-code = {
      enable = true;
      package = nodePkgs."@anthropic-ai/claude-code";
      settings = {
        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = true;
          ENABLE_LSP_TOOL = true;
        };
      };
      memory.text = builtins.readFile ./GLOBAL_CLAUDE.md;
    };

    # Import skills from anthropic-skills repository
    home.file = {
      ".claude/skills/sparze".source = inputs.sparze.outPath;
    };
  };
}
