{
  delib,
  lib,
  ...
}: let
  secretNames = [
    "vercel-ai-gateway-api-key"
    "openrouter-api-key"
    "opencode-api-key"
    "mistral-api-key"
    "zai-api-key"
    "cohere-api-key"
    "brave-api-key"
    "brave-free-api-key"
    "parallel-api-key"
    "exa-api-key"
    "command-code-api-key"
  ];
in
  delib.module ({cfg, ...}: {
    name = "secrets";
    meta.description = "Manage the selected encrypted secrets with nix-secrets.";

    options = with delib; {
      enable = boolOption true;
      names = listOfOption (types.enum secretNames) [];
    };

    hjem.ifEnabled = {config, ...}: {
      security.nix-secrets = {
        enable = true;
        storage = ../../../secrets;
        identityPaths = ["${config.directory}/.config/sops/age/keys.txt"];
        defaultRecipients = [
          "age1r990kv2jq2vd4fxhf6znzmqqg6w2wfhllw9s9uzjun6tvcd43e3san06yu"
          "age1jaf2jhvqsvdrwr5purlmea0uy0jauw000pllpz6ehe5eq5edg5dqc2dscd"
          "age1cwfytgvhlf23kxyt4r4et76uwva9jpudy7kdjgpgwtu287cvrawsw09t73"
          "age1fghhv0qqjj0z34cwru7xlepyechw8vsc2tz0zs4ug8ke3el34g3q5zmwwk"
        ];
        secrets = lib.genAttrs cfg.names (_: {});
      };
    };
  })
