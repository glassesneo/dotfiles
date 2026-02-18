{
  delib,
  brewCasks,
  host,
  ...
}:
delib.module {
  name = "programs.proton-drive";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.proton-drive
    ];
  };
}
