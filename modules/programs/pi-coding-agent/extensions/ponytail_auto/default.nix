{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.ponytail_auto";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.pi-coding-agent.settings.extensions = [
    "${./../../extensions_src}/ponytail_auto.ts"
  ];
}
