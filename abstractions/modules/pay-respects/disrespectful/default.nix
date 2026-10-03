{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "pay-respects.disrespectful";
  meta.description = "Replace command-not-found handling with sl.";

  options.enable = delib.boolOption false;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.sl];

    zsh.zshrc.sl.text = ''
      command_not_found_handler() {
        command ${lib.getExe pkgs.sl} ${lib.escapeShellArgs myconfig.pay-respects.slOptions}
        return 127
      }
    '';
  };
})
