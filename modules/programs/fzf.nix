{
  delib,
  homeConfig,
  lib,
  ...
}:
delib.module {
  name = "programs.fzf";

  options = delib.singleEnableOption true;

  home.ifEnabled = {myconfig, ...}: {
    programs.fzf = let
      fd-exe = lib.getExe homeConfig.programs.fd.package;
      base-command = "${fd-exe} -H -E .git --type f --strip-cwd-prefix";
      exclude-dir = myconfig.programs.git.ignore_names |> lib.strings.concatMapStringsSep " " (s: "-E " + s);
    in {
      enable = true;
      enableZshIntegration = true;
      defaultCommand = "${base-command} ${exclude-dir}";
      fileWidgetCommand = "${base-command} ${exclude-dir}";
      tmux = {
        enableShellIntegration = true;
      };
    };
  };
}
