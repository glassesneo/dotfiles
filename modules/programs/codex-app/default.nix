{
  brewCasks,
  delib,
  ...
}:
delib.module {
  name = "programs.codex-app";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.codex-app
    ];
  };
}
