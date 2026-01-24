{
  brewCasks ? {},
  delib,
  ...
}:
delib.module {
  name = "programs.claude-desktop";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.claude
    ];
  };
}
