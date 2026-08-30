{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}: let
  stateDir = "${homeConfig.xdg.stateHome}/sketchybar/notifications";
  logDir = "${homeConfig.xdg.stateHome}/sketchybar/notifications";
  runtimeDir = "${homeConfig.home.homeDirectory}/.config/sketchybar/widgets/notifications";
in
  delib.module {
    name = "services.sketchybar.widget-notifications";

    options = with delib;
      moduleOptions ({
        myconfig,
        parent,
        ...
      }: let
        name = "notifications";
        enabled =
          parent.enable
          && lib.any (section: lib.any (entry: entry.widget == name) parent.layout.${section}) parent.sections;
        socialApps =
          lib.optionals myconfig.programs.slack.enable [
            {
              id = "slack";
              label = "Slack";
              bundleId = "com.tinyspeck.slackmacgap";
              icon = "";
            }
          ]
          ++ lib.optionals myconfig.programs.discord.enable [
            {
              id = "discord";
              label = "Discord";
              bundleId = "com.hnc.Discord";
              icon = "";
            }
          ];
        self = myconfig.services.sketchybar.widget-notifications;
        handler = pkgs.replaceVars ./handler.nu {
          sketchybar-exe = lib.getExe pkgs.sketchybar;
          pbcopy = "/usr/bin/pbcopy";
          open = "/usr/bin/open";
          visible-limit = toString self.downloads.visibleLimit;
          apps-json = builtins.toJSON self.social.apps;
        };
        state = pkgs.replaceVars ./state.nu {
          state-dir = self.stateDir;
          sketchybar-exe = lib.getExe pkgs.sketchybar;
        };
        downloadsProvider = ./providers/downloads.nu;
        dockBadgeProvider = ./providers/dock-badge.nu;
        downloadsService = pkgs.replaceVars ./services/downloads.nu {
          downloads-path = self.downloads.path;
          fswatch = lib.getExe pkgs.fswatch;
          stability-seconds = toString self.downloads.stabilitySeconds;
        };
        socialService = pkgs.replaceVars ./services/social.nu {
          lsappinfo = "/usr/bin/lsappinfo";
          apps-json = builtins.toJSON self.social.apps;
        };
      in {
        enable = boolOption enabled;
        stateDir = readOnly (strOption stateDir);
        downloads = submoduleOption {
          options = {
            enable = boolOption (pkgs.stdenv.isDarwin && enabled);
            path = strOption "${homeConfig.home.homeDirectory}/Downloads";
            visibleLimit = intOption 3;
            stabilitySeconds = intOption 2;
          };
        } {};
        social = submoduleOption {
          options = {
            enable = boolOption (enabled && socialApps != []);
            pollIntervalSeconds = intOption 5;
            apps =
              listOfOption (submodule {
                options = {
                  id = strOption "";
                  label = strOption "";
                  bundleId = strOption "";
                  icon = strOption "";
                };
              })
              socialApps;
          };
        } {};
        handler = readOnly (packageOption handler);
        render = readOnly (packageOption (pkgs.replaceVars ./widget.nu {
          inherit name;
          script-path = null;
        }));
        runtimeFiles = readOnly (attrsOfOption path {
          "state.nu" = state;
          "providers/downloads.nu" = downloadsProvider;
          "providers/dock-badge.nu" = dockBadgeProvider;
          "services/downloads.nu" = downloadsService;
          "services/social.nu" = socialService;
        });
      });

    home.ifEnabled = {
      cfg,
      parent,
      ...
    }: {
      assertions = [
        {
          assertion = cfg.downloads.visibleLimit > 0;
          message = "services.sketchybar.widget-notifications.downloads.visibleLimit must be positive";
        }
        {
          assertion = cfg.downloads.stabilitySeconds > 0;
          message = "services.sketchybar.widget-notifications.downloads.stabilitySeconds must be positive";
        }
        {
          assertion = cfg.social.pollIntervalSeconds > 0;
          message = "services.sketchybar.widget-notifications.social.pollIntervalSeconds must be positive";
        }
        {
          assertion = lib.all (app: app.id != "" && app.label != "" && app.bundleId != "" && app.icon != "") cfg.social.apps;
          message = "services.sketchybar.widget-notifications.social.apps requires id, label, bundleId, and icon";
        }
        {
          assertion = lib.all (app: builtins.match "[A-Za-z0-9._-]+" app.id != null) cfg.social.apps;
          message = "services.sketchybar.widget-notifications.social.apps ids must be safe SketchyBar identifiers";
        }
      ];

      home.packages = [pkgs.fswatch];
      home.activation.sketchybarNotificationDirectories = homeConfig.lib.dag.entryAfter ["writeBoundary"] ''
        mkdir -p ${lib.escapeShellArg cfg.stateDir} ${lib.escapeShellArg logDir}
      '';

      launchd.agents."sketchybar-notifications-downloads" = lib.mkIf cfg.downloads.enable {
        enable = true;
        config = {
          Label = "local.sketchybar.notifications.downloads";
          ProgramArguments = [
            (lib.getExe parent.nushellPackage)
            "${runtimeDir}/services/downloads.nu"
          ];
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 10;
          StandardOutPath = "${logDir}/downloads.stdout.log";
          StandardErrorPath = "${logDir}/downloads.stderr.log";
        };
      };

      launchd.agents."sketchybar-notifications-social" = lib.mkIf cfg.social.enable {
        enable = true;
        config = {
          Label = "local.sketchybar.notifications.social";
          ProgramArguments = [
            (lib.getExe parent.nushellPackage)
            "${runtimeDir}/services/social.nu"
          ];
          RunAtLoad = true;
          StartInterval = cfg.social.pollIntervalSeconds;
          StandardOutPath = "${logDir}/social.stdout.log";
          StandardErrorPath = "${logDir}/social.stderr.log";
        };
      };
    };
  }
