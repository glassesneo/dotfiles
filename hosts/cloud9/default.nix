{delib, ...}:
delib.host {
  name = "cloud9";
  type = "server";
  defaultFeatures = [];
  rice = "clean";
  tier = "basic";

  homeManagerUser = "ec2-user";
  homeManagerSystem = "x86_64-linux";
  home.home.stateVersion = "25.05";

  myconfig = {
    toplevel.secrets.enable = false;

    programs = {
      nvf = {
        enable = true;
        copilot.enable = false;
        denops.enable = false;
        orgmode.enable = false;
        skkeleton.enable = false;
        visuals.enable = false;
        autocomplete.enable = false;
        snacks.enable = false;
        languages = {
          c.enable = false;
          lua.enable = false;
          moonbit.enable = false;
          nix.enable = false;
          nu.enable = false;
          typst.enable = false;
          zig.enable = false;
        };
      };
      pi-coding-agent.enable = false;
    };
  };
}
