{pkgs, ...}: {
  projectRootFile = "flake.nix";

  programs.alejandra.enable = true;
  programs.shfmt.enable = true;

  settings.formatter.luafmt = {
    command = "${pkgs.emmylua-formatter}/bin/luafmt";
    options = ["--write"];
    includes = ["*.lua"];
  };
}
