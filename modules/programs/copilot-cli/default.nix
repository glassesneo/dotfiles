{
  delib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.copilot-cli";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      llm-agents.copilot-cli
    ];
  };
}
