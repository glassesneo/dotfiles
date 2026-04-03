{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.autoraise";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home = {
      packages = [
        pkgs.autoraise
      ];
    };
    xdg.configFile."AutoRaise/config".text = ''
      delay=1
      requireMouseStop=true
    '';

    launchd.agents."autoraise" = {
      enable = true;
      config = {
        Label = "com.${host.name}.autoraise";
        ProgramArguments = [
          "${lib.getExe pkgs.autoraise}"
        ];
        RunAtLoad = true;
      };
    };
  };
}
