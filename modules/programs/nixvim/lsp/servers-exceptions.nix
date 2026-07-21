{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.servers-exceptions";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = {
    extraPackages = [
      pkgs.efm-langserver
      pkgs.nls
      pkgs.nickel
    ];
  };
}
