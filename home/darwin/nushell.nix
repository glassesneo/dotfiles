{
  config,
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
      starship_config =
        if config.programs.starship.enable
        then ''
          # starship
          mkdir ($nu.data-dir | path join "vendor/autoload")
          starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
        ''
        else '''';
    in
      ''
        alias reload-sketchybar = nu ~/.config/sketchybar/sketchybarrc.nu
        ${completions ["bat" "eza" "gh" "git" "less" "man" "nix" "ssh" "tar" "typst"]}
      ''
      + starship_config;
    plugins = with pkgs.nushellPlugins; [
      highlight
      gstat
    ];
  };
}
