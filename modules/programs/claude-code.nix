{delib, ...}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.claude-code = {
    enable = true;
  };
}
