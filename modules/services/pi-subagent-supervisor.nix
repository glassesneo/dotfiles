{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}: let
  moduleName = "services.pi-subagent-supervisor";
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = readOnly (boolOption myconfig.programs.pi-coding-agent.subagent.enable);
        runtimeConfigPath = readOnly (strOption "${myconfig.programs.pi-coding-agent.configDir}/subagent.json");
      });

    home.ifEnabled = {cfg, myconfig, ...}: let
      stateParent = "${homeConfig.xdg.stateHome}/pi/subagents";
      logDir = "${stateParent}/logs";
      node = lib.getExe pkgs.nodejs;
      supervisor = "${../programs/pi-coding-agent/extensions_src}/subagent_supervisor.ts";
      argv = [node "--experimental-strip-types" supervisor cfg.runtimeConfigPath];
    in lib.mkMerge [
      {
        home.activation.piSubagentSupervisorDirectories = homeConfig.lib.dag.entryAfter ["writeBoundary"] ''
          install -d -m 0700 ${lib.escapeShellArg stateParent} ${lib.escapeShellArg logDir}
        '';
      }
      (lib.mkIf pkgs.stdenv.isDarwin {
        launchd.agents.pi-subagent-supervisor = {
          enable = true;
          domain = "user";
          config = {
            Label = "pi-subagent-supervisor";
            ProgramArguments = argv;
            RunAtLoad = true;
            KeepAlive = {SuccessfulExit = false;};
            AbandonProcessGroup = true;
            ProcessType = "Background";
            StandardOutPath = "${logDir}/stdout.log";
            StandardErrorPath = "${logDir}/stderr.log";
          };
        };
      })
      (lib.mkIf pkgs.stdenv.isLinux {
        systemd.user.services.pi-subagent-supervisor = {
          Unit.Description = "Pi durable subagent supervisor";
          Service = {
            ExecStart = lib.concatMapStringsSep " " lib.escapeShellArg argv;
            Restart = "on-failure";
            RestartSec = 1;
            KillMode = "process";
            StandardOutput = "append:${logDir}/stdout.log";
            StandardError = "append:${logDir}/stderr.log";
            UMask = "0077";
          };
          Install.WantedBy = ["default.target"];
        };
      })
    ];
  }
