{
  pkgs,
  lib,
  ...
}: {
  home.packages = [
    pkgs.nu_scripts
  ];
  programs.nushell = {
    enable = true;
    configFile.source = ../../nushell/config.nu;
    envFile.source = ../../nushell/env.nu;
    extraConfig = let
      completion = name: ''
        use ${pkgs.nu_scripts}/share/nu_scripts/custom-completions/${name}/${name}-completions.nu *
      '';
      completions = names: (lib.strings.concatMapStrings completion names);
    in ''
      alias reload-sketchybar = nu ~/.config/sketchybar/sketchybarrc.nu
      ${completions ["bat" "eza" "gh" "git" "less" "man" "nix" "ssh" "tar" "typst"]}
    '';
    plugins = with pkgs.nushellPlugins; [
      highlight
      gstat
    ];
  };
}
