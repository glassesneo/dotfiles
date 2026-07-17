{
  delib,
  homeConfig,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.pi-coding-agent";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.pi-coding-agent = {
      enable = true;
      package = llm-agents.pi;
      # configDir = "${homeConfig.xdg.configHome}/.pi/agent";
      settings = {
        extensions = [
          "${./extensions/agent_artifact.ts}"
        ];
        prompts = [
          "${./prompts}"
        ];
      };
    };
  };
}
