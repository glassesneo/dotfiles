{
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}: let
  colorType = lib.types.strMatching "0x[0-9a-fA-F]{8}";
  mkColorOption = name: default:
    with delib;
      description ((strOption default) // {type = colorType;}) "SketchyBar semantic color ${name} in 0xAARRGGBB format.";
  colorOptions = lib.mapAttrs mkColorOption {
    text_primary = "0xffabb2bf";
    text_muted = "0xff6c7891";
    workspace_active = "0xffe06c75";
    accent_datetime = "0xffabb2bf";
    status_error = "0xffe06c75";
    status_warning = "0xffabb2bf";
    status_caution = "0xffa0a0a0";
    status_success = "0xffabb2bf";
    status_charging = "0xffa0a0a0";
    app_arc = "0xffe06c75";
    app_ghostty = "0xffa0a0a0";
    app_obsidian = "0xffe06c75";
    app_kitty = "0xffa0a0a0";
    island_surface = "0x26252525";
    island_border = "0x406c7891";
    active_indicator = "0x50e06c75";
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
          a = ["aerospace_workspace"];
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
      # Silently drop widgets that are defined but disabled (for example, the
      # Aerospace-only workspace widget on a Rift-backed host) so SketchyBar
      # stays functional regardless of which WM provider is active.
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
      in ''
        mkdir -p "$out/${widgetDir}"
        cp ${lib.escapeShellArg widget.render} "$out/${widgetDir}/widget.nu"
        cp ${lib.escapeShellArg widget.handler} "$out/${widgetDir}/handler.nu"
        chmod +w "$out/${widgetDir}/widget.nu"
        substituteInPlace "$out/${widgetDir}/widget.nu" \
          --replace-fail '@script-path@' "$out/${widgetDir}/script"
        printf '%s\n' \
          '#!${pkgs.runtimeShell}' \
          "exec ${nushellBin} \"$out/${widgetDir}/handler.nu\"" \
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
      # home.activation.sketchybarHackNerdFont = homeConfig.lib.dag.entryAfter ["linkGeneration"] ''
      # mkdir -p "$HOME/Library/Fonts"
      # rm -f "$HOME"/Library/Fonts/HackGen*NF*.ttf
      # cp -f ${pkgs.nerd-fonts.hack}/share/fonts/truetype/NerdFonts/Hack/*.ttf "$HOME/Library/Fonts/"
      # atsutil databases -removeUser >/dev/null 2>&1 || true
      # '';
    };
  }
