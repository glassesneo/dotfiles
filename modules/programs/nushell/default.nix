{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nushell";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    plugin_names = [
      "gstat"
      # "net"
      # "skim"
      "query"
    ];
  in {
    xdg.configFile = {
      "nushell/completions" = {
        source = ./completions;
      };
      "nushell/plugins" = {
        source = ./plugins;
      };
    };
    programs.nushell = {
      enable = true;
      configFile.source = ./config.nu;
      envFile.source = ./env.nu;
      extraConfig = let
        completion = name: ''
          use ${pkgs.nu_scripts}/share/nu_scripts/custom-completions/${name}/${name}-completions.nu *
        '';
        completions = names: (lib.strings.concatMapStrings completion names);
      in ''
        ${completions ["aerospace" "bat" "curl" "eza" "gh" "git" "less" "make" "man" "nano" "nix" "npm" "rg" "ssh" "tar" "typst" "zellij"]}
      '';
      plugins = map (name: pkgs.nushellPlugins.${name}) plugin_names;
      extraEnv = let
        plugin_dir = plugin: ''
          ${pkgs.nushellPlugins.${plugin}}/bin/nu_plugin_${plugin},
        '';
      in ''
        $env.PATH ++= [
          ${lib.strings.concatMapStrings plugin_dir plugin_names}
        ]
      '';
      settings = {
        show_banner = false;
        completions = {
          case_sensitive = true;
        };
      };
    };
  };
}
