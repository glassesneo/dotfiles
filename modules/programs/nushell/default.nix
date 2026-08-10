{
  delib,
  host,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nushell";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = let
    plugin_names = [
      "gstat"
      "query"
    ];

    secretEnv = name: variable:
      lib.optionalString (builtins.hasAttr name homeConfig.sops.secrets) ''
        if ("${homeConfig.sops.secrets.${name}.path}" | path exists) {
          $env.${variable} = (open "${homeConfig.sops.secrets.${name}.path}" | str trim)
        }
      '';
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
        ${completions ["aerospace" "bat" "curl" "eza" "gh" "git" "less" "make" "man" "nano" "nix" "npm" "pnpm" "rg" "ssh" "tar" "typst" "uv" "zoxide"]}
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

        ${secretEnv "ai-mop-api-key" "AI_MOP_API_KEY"}
        ${secretEnv "iniad-id" "INIAD_ID"}
        ${secretEnv "iniad-password" "INIAD_PASSWORD"}
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
