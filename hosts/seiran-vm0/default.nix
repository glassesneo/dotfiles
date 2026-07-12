{delib, ...}:
delib.host {
  name = "seiran-vm0";
  type = "virtual";
  tier = "standard";
  myconfig.programs.proton-pass-cli.enable = false;
  myconfig.programs.reload.enable = false;
  myconfig.programs.mcp-servers-nix.enable = false;
  myconfig.programs.codex.sandboxMode = "danger-full-access";
  myconfig.programs.opencode.implementationCommandExecution = "allow";
  myconfig.programs.zsh.zeno.enable = false;

  nixos = {
    services.openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = false;
        PermitRootLogin = "no";
      };
    };
    users.groups.neo = {};
    users.users.neo = {
      isNormalUser = true;
      extraGroups = ["wheel" "networkmanager"];
      group = "neo";
      openssh.authorizedKeys.keys = [
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC43jV/scFhyOWFlrpv4jDxn5Ef002X+wh56oUP4SZzK glassesneo@protonmail.com"
      ];
    };
    security.sudo.wheelNeedsPassword = false;
  };
}
