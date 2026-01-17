{
  delib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.agent-browser";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      llm-agents.agent-browser
    ];
  };
}
