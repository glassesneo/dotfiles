{
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.crush";

  options = delib.singleEnableOption false;

  darwin.ifEnabled = {
    # imports = [
    # inputs.nur.modules.nixos.default
    # inputs.nur.repos.charmbracelet.modules.crush
    # ];
    # programs.crush = {
    # enable = true;
    # };
  };
}
