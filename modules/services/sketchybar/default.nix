{
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}: let
  sectionOrder = ["a" "b" "c" "x" "y" "z"];
  leftSections = ["a" "b" "c"];
  layoutEntryType = lib.types.coercedTo lib.types.str (widget: {inherit widget;}) (
    lib.types.submodule {
      options = {
        widget = lib.mkOption {
          type = lib.types.str;
        };
      };
    }
  );
  layoutType = lib.types.submodule {
    options = lib.genAttrs sectionOrder (section:
      lib.mkOption {
        type = lib.types.listOf layoutEntryType;
        default =
          if section == "z"
          then [{widget = "datetime";}]
          else [];
      });
  };
in
  delib.module {
    name = "services.sketchybar";

    options = with delib;
      moduleOptions {
        enable = boolOption (pkgs.stdenv.isDarwin && host.windowManagementFeatured);
        nushellPackage = packageOption pkgs.nushell;
        position = enumOption ["top" "bottom"] (
          if host.hasNotch
          then "top"
          else "bottom"
        );
        layout = lib.mkOption {
          type = layoutType;
          default = {};
        };
      };

    darwin.ifEnabled = {cfg, ...}: {
      services.sketchybar = {
        enable = true;
        extraPackages = [
          cfg.nushellPackage
        ];
      };

      launchd.user.agents.sketchybar.serviceConfig = {
        StandardOutPath = "${homeConfig.xdg.stateHome}/sketchybar/stdout.log";
        StandardErrorPath = "${homeConfig.xdg.stateHome}/sketchybar/stderr.log";
      };
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      nushellBin = lib.getExe cfg.nushellPackage;
      normalizedLayout = lib.concatMap (section:
        map (entry:
          entry
          // {
            inherit section;
            direction =
              if builtins.elem section leftSections
              then "left"
              else "right";
          })
        cfg.layout.${section})
      sectionOrder;
      enabledWidgets = map (entry: entry.widget) normalizedLayout;
      availableWidgets =
        map (name: lib.removePrefix "widget-" name)
        (lib.filter (name: lib.hasPrefix "widget-" name) (builtins.attrNames myconfig.services.sketchybar));
      unknownWidgets = lib.filter (widget: !(builtins.elem widget availableWidgets)) enabledWidgets;
      renderableLayout = lib.filter (entry: !(builtins.elem entry.widget unknownWidgets)) normalizedLayout;
      config = pkgs.replaceVars ./rc/config.nu {
        inherit (cfg) position;
      };
      widgetOf = key: myconfig.services.sketchybar."widget-${key}";
      sketchybarrc =
        ''
          #!${lib.getExe pkgs.nushell}
          ${builtins.readFile config}
        ''
        + lib.concatStringsSep "\n" (map (entry: "${nushellBin} ${(widgetOf entry.widget).render} ${entry.direction}") renderableLayout)
        + "\n"
        + ''
          sketchybar --update
        '';
    in {
      assertions = [
        {
          assertion = lib.length enabledWidgets == lib.length (lib.unique enabledWidgets);
          message = "services.sketchybar.layout: duplicate widgets are not allowed across sections";
        }
        {
          assertion = unknownWidgets == [];
          message = "services.sketchybar.layout: unknown widgets: ${lib.concatStringsSep ", " unknownWidgets}";
        }
      ];

      home.file = {
        ".config/sketchybar/sketchybarrc" = {
          text = sketchybarrc;
          executable = true;
        };
      };
    };
  }
