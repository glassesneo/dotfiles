{delib, ...}:
delib.module {
  name = "programs.fd";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.fd = {
    enable = true;
  };
}
