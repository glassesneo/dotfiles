{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.jules";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      nodePkgs."@google/jules"
    ];
  };
}
