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
    # Bootstrap without an Age key. Install the key before re-enabling.
    toplevel.secrets = {
      enable = false;
      names = ["brave-api-key"];
    };
    nix-darwin.preferences = {
      appearance.enable = false;
      dock.enable = false;
      feedback.enable = false;
      input.enable = false;
      language.enable = false;
      spaces.enable = false;
      accessibility.zoom.enable = false;
    };
    programs = {
      opencode.permissionPolicy = "trusted-vm";
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
    user.uid = 502;
  };

  darwin = {
    system.defaults = {
      CustomUserPreferences = {
        NSGlobalDomain = {
          AppleLanguages = [
            "en-US"
            "ja-JP"
          ];

          AppleLocale = "en_US";
        };
      };
    };
    nix = {
      distributedBuilds = true;

      settings = {
        builders-use-substitutes = true;
      };

      buildMachines = [
        {
          hostName = "172.16.244.135";
          protocol = "ssh-ng";
          sshUser = "neo";
          sshKey = "/var/root/.ssh/nix-host-builder";

          system = "aarch64-darwin";

          maxJobs = 8;
          speedFactor = 2;

          supportedFeatures = [
            "benchmark"
            "big-parallel"
          ];

          mandatoryFeatures = [];
        }
      ];
    };
    security.pam.services.sudo_local = {
      reattach = lib.mkForce false;
      touchIdAuth = lib.mkForce false;
      watchIdAuth = lib.mkForce false;
    };

    # Keep the guest awake while it is used through SSH or by long-running agents.
    system.activationScripts.postActivation.text = lib.mkAfter ''
      /usr/bin/pmset -a sleep 0
    '';

    services.openssh = {
      enable = true;
      extraConfig = ''
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
