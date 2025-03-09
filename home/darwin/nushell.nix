{
  config,
  pkgs,
  lib,
  ...
}: {
  home.packages = [
    pkgs.nu_scripts
  ];
  xdg.configFile = {
    "nushell/completions" = {
      source = ../../nushell/completions;
    };
  };
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
        ${completions ["bat" "eza" "gh" "git" "less" "man" "nix" "ssh" "tar" "typst" "zellij"]}
      ''
      + starship_config;
    plugins = with pkgs.nushellPlugins; [
      gstat
      highlight
      skim
    ];
    extraEnv = let
      plugin_dir = plugin: ''
        ${pkgs.nushellPlugins.${plugin}}/bin/nu_plugin_${plugin},
      '';
    in ''
      $env.PATH ++= [
        ${lib.strings.concatMapStrings plugin_dir ["gstat" "highlight" "skim"]}
      ]
    '';
    shellAliases = {
      bd = "cd ..";
      tree = lib.mkIf config.programs.eza.enable "eza --tree";
      projectroot = "git rev-parse --show-toplevel";
    };
    settings = {
      show_banner = false;
      buffer_editor =
        if config.programs.neovim.enable
        then "nvim"
        else "vim";
      completions = {
        case_sensitive = true;
      };
    };
  };
}
