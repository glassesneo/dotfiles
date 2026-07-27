{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.agent_artifact";

  options = delib.singleCascadeEnableOption;

  myconfig.ifEnabled.programs.pi-coding-agent.profile.profiles = {
    scout.tools = ["save_agent_artifact"];
  };

  home.ifEnabled = {
    programs.pi-coding-agent.settings.extensions = [
      "${./../../extensions_src}/agent_artifact.ts"
    ];
  };
}
