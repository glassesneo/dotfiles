{
  delib,
  lib,
  ...
}:
delib.host {
  name = "seiran-vm1";
  type = "virtual";
  rice = "monochrome";
  tier = "standard";

  myconfig = {
    darwin.window-manager.enable = false;
    nix-darwin.preferences = {
      appearance.enable = false;
      dock.enable = false;
      input.enable = false;
      spaces.enable = false;
    };
    programs = {
      orbstack.enable = false;
      tart.enable = false;
    };
    services = {
      aerospace.enable = false;
      kanata = {
        enable = false;
        profile = null;
      };
      rift.enable = false;
      sketchybar.enable = false;
    };
    user.uid = 501;
  };

  darwin = {
    security.pam.services.sudo_local = {
      reattach = lib.mkForce false;
      touchIdAuth = lib.mkForce false;
      watchIdAuth = lib.mkForce false;
    };

    # Keep the guest awake while it is used through SSH or by long-running agents.
    system.activationScripts.postActivation.text = lib.mkAfter ''
      /usr/bin/pmset -a sleep 0
    '';

    # The VM only receives credentials required by its enabled agent tooling:
    # OpenCode/Codex use OpenRouter, and OpenCode's Brave MCP uses Brave Search.
    sops.secrets = lib.mkForce (lib.genAttrs [
        "brave-api-key"
      ] (_: {
        sopsFile = ../../secrets/shared.yaml;
        owner = "neo";
        mode = "0400";
      }));

    services.openssh = {
      enable = true;
      extraConfig = ''
        AuthorizedKeysFile none
        PasswordAuthentication no
        KbdInteractiveAuthentication no
        PermitRootLogin no
      '';
    };

    users.users.neo.openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC43jV/scFhyOWFlrpv4jDxn5Ef002X+wh56oUP4SZzK glassesneo@protonmail.com"
    ];
  };
}
