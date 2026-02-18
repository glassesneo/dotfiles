{
  delib,
  brewCasks,
  host,
  ...
}:
delib.module {
  name = "programs.proton-pass";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.proton-pass
    ];
  };
}
