{delib, ...}:
delib.host {
  name = "cloud9";
  type = "server";
  rice = "clean";
  tier = "basic";

  homeManagerUser = "ec2-user";
  homeManagerSystem = "x86_64-linux";
  home.home.stateVersion = "25.05";

  myconfig = {
    toplevel.secrets.enable = false;

    programs = {
      agent-browser.enable = false;
      codex.enable = false;
      cursor-agent.enable = false;
      git.include.enable = false;
      nvf = {
        copilot.enable = false;
        orgmode.enable = false;
        languages = {
          c.enable = false;
          moonbit.enable = false;
          typst.enable = false;
          zig.enable = false;
        };
      };
      pi-coding-agent.enable = false;
      proton-pass-cli.enable = false;
      reload.enable = false;
      skills-deployer.enable = false;
    };
  };
}
