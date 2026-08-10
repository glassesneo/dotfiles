{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}: let
  defaultSopsFile = ../../secrets/shared.yaml;
  sharedSecretNames = [
    "gemini-api-key"
    "ai-mop-api-key"
    "brave-api-key"
    "brave-free-api-key"
    "parallel-api-key"
    "exa-api-key"
    "openrouter-api-key"
    "cerebras-api-key"
    "google-cloud-api-key"
    "zai-api-key"
    "iniad-id"
    "iniad-password"
  ];
  secretEntryType = lib.types.submodule ({name, ...}: {
    options = {
      source = lib.mkOption {
        type = lib.types.path;
        default = defaultSopsFile;
      };
      format = lib.mkOption {
        type = lib.types.enum ["yaml" "json" "ini" "dotenv" "binary"];
        default = "yaml";
      };
      key = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = name;
      };
      mode = lib.mkOption {
        type = lib.types.strMatching "[0-7]{4}";
        default = "0400";
      };
    };
  });
in
  delib.module {
    name = "toplevel.secrets";

    options = with delib;
      moduleOptions {
        enable = boolOption true;
        entries = attrsOfOption secretEntryType (lib.genAttrs sharedSecretNames (_: {}));
      };

    home.always.imports = [inputs.sops-nix.homeManagerModules.sops];

    home.ifEnabled = {cfg, ...}:
      lib.mkMerge [
        {
          sops = {
            age.keyFile = "${homeConfig.xdg.configHome}/sops/age/keys.txt";
            defaultSopsFile = defaultSopsFile;
            secrets =
              lib.mapAttrs (_: entry: {
                sopsFile = entry.source;
                inherit (entry) format mode;
                key =
                  if entry.key == null
                  then ""
                  else entry.key;
              })
              cfg.entries;
          };
        }
        (lib.mkIf (pkgs.stdenv.isDarwin && cfg.entries != {}) {
          launchd.agents.sops-nix.domain = "user";
          home.activation.sops-nix = lib.mkForce (homeConfig.lib.dag.entryAfter ["setupLaunchAgents"] ''
            /bin/launchctl kickstart -k "user/$(id -u)/org.nix-community.home.sops-nix"
          '');
        })
      ];
  }
