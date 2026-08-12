{
  colorscheme,
  colorschemeLib,
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}: let
  inherit (colorscheme) palette;
  argb = colorschemeLib.toArgb "ff";
  argbLow = colorschemeLib.toArgb "26";
  argbBorder = colorschemeLib.toArgb "40";
  argbIndicator = colorschemeLib.toArgb "50";
  schemeColors =
    if colorscheme.name == "catppuccin"
    then {
      workspaceActive = palette.base08;
      accentDatetime = palette.base0C;
      statusWarning = palette.base0A;
      statusSuccess = palette.base0B;
      statusCharging = palette.base09;
      appArc = palette.base06;
      activeIndicator = palette.base08;
      islandSurface = palette.base02;
    }
    else if colorscheme.name == "everforest"
    then {
      workspaceActive = palette.base0B;
      accentDatetime = palette.base0C;
      statusWarning = palette.base0A;
      statusSuccess = palette.base0B;
      statusCharging = palette.base09;
      appArc = palette.base06;
      activeIndicator = palette.base0B;
      islandSurface = palette.base02;
    }
    else {
      workspaceActive = palette.base08;
      accentDatetime = palette.base05;
      statusWarning = palette.base05;
      statusSuccess = palette.base05;
      statusCharging = palette.base0A;
      appArc = palette.base08;
      activeIndicator = palette.base08;
      islandSurface = palette.base01;
    };
  colorType = lib.types.strMatching "0x[0-9a-fA-F]{8}";
  mkColorOption = name: default:
    with delib;
      description ((strOption default) // {type = colorType;}) "SketchyBar semantic color ${name} in 0xAARRGGBB format.";
  colorOptions = lib.mapAttrs mkColorOption {
    text_primary = argb palette.base05;
    text_muted = argb palette.base04;
    workspace_active = argb schemeColors.workspaceActive;
    accent_datetime = argb schemeColors.accentDatetime;
    status_error = argb palette.base08;
    status_warning = argb schemeColors.statusWarning;
    status_caution = argb palette.base09;
    status_success = argb schemeColors.statusSuccess;
    status_charging = argb schemeColors.statusCharging;
    app_arc = argb schemeColors.appArc;
    app_ghostty = argb palette.base0D;
    app_obsidian = argb palette.base0E;
    app_kitty = argb palette.base0F;
    island_surface = argbLow schemeColors.islandSurface;
    island_border = argbBorder palette.base04;
    active_indicator = argbIndicator schemeColors.activeIndicator;
  };
  sectionOrder = ["a" "b" "c" "x" "y" "z"];
  leftSections = ["a" "b" "c"];
  layoutEntryType = with delib;
    coercedTo str (widget: {inherit widget;}) (
      submodule {
        options = {
          widget = noDefault (strOption null);
        };
      }
    );
  layoutModule = {
    options = lib.genAttrs sectionOrder (section:
      with delib;
        listOfOption layoutEntryType (
          if section == "z"
          then [{widget = "datetime";}]
          else []
        ));
  };
in
  delib.module {
    name = "services.sketchybar";

    options = with delib;
      moduleOptions {
        enable = boolOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);
        nushellPackage = packageOption pkgs.nushell;
        colors = description (submoduleOption {
          options = colorOptions;
        } {}) "Semantic color palette for SketchyBar items and UI elements.";
        position = enumOption ["top" "bottom"] (
          if host.hasNotch
          then "top"
          else "bottom"
        );
        layout = submoduleOption layoutModule {
          a = ["workspace"];
          b = [];
          c = [];
          x = ["media"];
          y = ["battery"];
          z = ["datetime"];
        };
        sections = readOnly (listOfOption str sectionOrder);
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
      widgetOf = key: myconfig.services.sketchybar."widget-${key}";
      disabledWidgets = lib.filter (widget: builtins.elem widget availableWidgets && !((widgetOf widget).enable)) enabledWidgets;
      renderableLayout =
        lib.filter
        (entry: !(builtins.elem entry.widget unknownWidgets) && !(builtins.elem entry.widget disabledWidgets))
        normalizedLayout;
      renderLayout =
        lib.filter (entry: entry.direction == "left") renderableLayout
        ++ lib.reverseList (lib.filter (entry: entry.direction == "right") renderableLayout);
      colors = pkgs.replaceVars ./colors.nu cfg.colors;
      config = pkgs.replaceVars ./config.nu {
        inherit (cfg) position;
      };
      copyWidget = entry: let
        widget = widgetOf entry.widget;
        widgetDir = "widgets/${entry.widget}";
        copyRuntimeFile = target: source: ''
          mkdir -p "$out/${widgetDir}/${builtins.dirOf target}"
          cp ${source} "$out/${widgetDir}/${target}"
        '';
      in ''
        mkdir -p "$out/${widgetDir}"
        cp ${lib.escapeShellArg widget.render} "$out/${widgetDir}/widget.nu"
        cp ${lib.escapeShellArg widget.handler} "$out/${widgetDir}/handler.nu"
        ${lib.concatStringsSep "\n" (lib.mapAttrsToList copyRuntimeFile (widget.runtimeFiles or {}))}
        chmod +w "$out/${widgetDir}/widget.nu"
        substituteInPlace "$out/${widgetDir}/widget.nu" \
          --replace-fail '@script-path@' "$out/${widgetDir}/script"
        if grep -q '__script_path__' "$out/${widgetDir}/handler.nu"; then
          substituteInPlace "$out/${widgetDir}/handler.nu" \
            --replace-fail '__script_path__' "$out/${widgetDir}/script"
        fi
        printf '%s\n' \
          '#!${pkgs.runtimeShell}' \
          "exec ${nushellBin} \"$out/${widgetDir}/handler.nu\" \"\$@\"" \
          > "$out/${widgetDir}/script"
        chmod +x "$out/${widgetDir}/script"
      '';
      renderCommand = entry: ''
        ^${nushellBin} $"($config_dir)/widgets/${entry.widget}/widget.nu" ${entry.direction}
      '';
      sketchybarrc = pkgs.writeText "sketchybarrc" (
        ''
          #!${nushellBin}
          let config_dir = $env.FILE_PWD
          ^${nushellBin} $"($config_dir)/config.nu"
        ''
        + lib.concatStringsSep "\n" (map renderCommand renderLayout)
        + "\n"
        + ''
          sketchybar --update
        ''
      );
      sketchybarConfig = pkgs.runCommand "sketchybar-config" {} ''
        mkdir -p "$out"
        cp ${lib.escapeShellArg colors} "$out/colors.nu"
        cp ${lib.escapeShellArg config} "$out/config.nu"
        cp ${lib.escapeShellArg sketchybarrc} "$out/sketchybarrc"
        chmod +x "$out/sketchybarrc"

        # Nushell relative imports depend on this generated tree matching the
        # repository layout: colors.nu/config.nu at the root, widgets below.
        ${lib.concatStringsSep "\n" (map copyWidget renderLayout)}
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
        {
          assertion = disabledWidgets == [];
          message = "services.sketchybar.layout: disabled widgets are referenced: ${lib.concatStringsSep ", " disabledWidgets}";
        }
      ];

      home.file = {
        ".config/sketchybar" = {
          source = sketchybarConfig;
          recursive = true;
        };
      };
      home.packages = [
        pkgs.nerd-fonts.hack
      ];
    };
  }
