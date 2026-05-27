{
  delib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.copilot-cli";

  options = delib.singleEnableOption false;

  home.ifEnabled = {
    home.packages = [
      llm-agents.copilot-cli
    ];
  };
}
