{
  delib,
  brewCasks,
  ...
}:
delib.module {
  name = "programs.proton-drive";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    environment.systemPackages = [
      brewCasks.proton-drive
    ];
  };
}
