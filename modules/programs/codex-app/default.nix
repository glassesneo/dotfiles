{
  brewCasks,
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.codex-app";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.codex-app
    ];
  };
}
