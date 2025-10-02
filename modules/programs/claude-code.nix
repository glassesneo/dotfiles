{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      nodePkgs."@zed-industries/claude-code-acp"
    ];
    programs.claude-code = {
      enable = true;
      package = nodePkgs."@anthropic-ai/claude-code";
    };
  };
}
