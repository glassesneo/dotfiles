{
  delib,
  # host,
  inputs,
  ...
}:
delib.module {
  name = "programs.crush";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    imports = [
      inputs.charmbracelet.modules.homeManager.crush
    ];
    programs.crush = {
      enable = true;
    };
  };
}
