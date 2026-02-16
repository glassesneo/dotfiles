{
  delib,
  brewCasks,
  ...
}:
delib.module {
  name = "programs.proton-pass";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.proton-pass
    ];
  };
}
