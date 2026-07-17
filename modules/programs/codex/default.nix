{
  delib,
  host,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.codex";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs.codex = {
      enable = true;
      package = llm-agents.codex;
    };
  };
}
