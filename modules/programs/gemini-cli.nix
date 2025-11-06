{
  delib,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.gemini-cli";

  options = delib.singleEnableOption false;

  home.ifEnabled = {
    programs.gemini-cli = {
      enable = true;
      package = nodePkgs."@google/gemini-cli";
    };
  };
}
