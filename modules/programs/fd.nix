{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.fd";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled.programs.fd = {
    enable = true;
  };
}
