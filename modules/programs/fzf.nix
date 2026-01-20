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
      defaultOptions = [
        "--color=bg:-1,list-bg:-1,preview-bg:-1,input-bg:-1,header-bg:-1,footer-bg:-1"
        "--color=gutter:-1,border:-1"
        "--border=sharp"
        "--no-separator"
        "--no-scrollbar"
      ];
      fileWidgetCommand = "${base-command} ${exclude-dir}";
      tmux = {
        enableShellIntegration = true;
        shellIntegrationOptions = [
          "-p 80%,50%"
        ];
      };
    };
  };
}
