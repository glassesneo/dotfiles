{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.interaction_policy";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.pi-coding-agent.settings.extensions = [
      "${./../../extensions_src}/interaction_policy.ts"
    ];
  };
}
