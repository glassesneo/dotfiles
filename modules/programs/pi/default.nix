{
  delib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.pi";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      llm-agents.pi
    ];
    # home.file.".pi/agent/settings.json".text = pkgs.formats.json {
    # defaultProvider = "openai";

    # defaultThinkingLevel = "medium";
    # };
  };
}
