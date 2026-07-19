{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.agent_artifact";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.pi-coding-agent.settings.extensions = [
      "${./../../extensions_src}/agent_artifact.ts"
    ];
  };
}
