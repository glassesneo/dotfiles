{
  brewCasks,
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.claude-desktop";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.claude
    ];
  };
}
