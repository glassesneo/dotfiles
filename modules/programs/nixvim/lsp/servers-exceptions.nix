{
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.servers-exceptions";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = let
    treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs ../../../../treefmt.nix;
  in {
    extraPackages = [
      pkgs.efm-langserver
      pkgs.nls
      pkgs.nickel
      treefmtEval.config.build.wrapper
    ];
  };
}
