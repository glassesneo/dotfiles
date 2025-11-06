{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.jules";

  options = delib.singleEnableOption false;

  home.ifEnabled = {
    home.packages = [
      nodePkgs."@google/jules"
    ];
  };
}
