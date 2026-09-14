{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}: let
  entryType = lib.types.submodule {
    options = {
      source = lib.mkOption {
        type = lib.types.str;
        description = "Nix store executable copied onto the stable destination.";
      };
      scope = lib.mkOption {
        type = lib.types.enum ["user" "system"];
        description = "user copies into the login-user bin dir; system copies as root into /Library.";
      };
    };
  };
  destFor = cfg: name: entry:
    if entry.scope == "system"
    then "${cfg.systemDir}/${name}"
    else "${cfg.userDir}/${name}";
  copyFile = {
    rsync,
    source,
    dest,
    privileged,
  }: ''
    $DRY_RUN_CMD mkdir -p ${lib.escapeShellArg (dirOf dest)}
    if [ -e ${lib.escapeShellArg dest} ]; then
      $DRY_RUN_CMD chmod u+w ${lib.escapeShellArg dest} || true
    fi
    $DRY_RUN_CMD ${rsync} --checksum --copy-links --chmod=F755 \
      ${lib.escapeShellArg source} ${lib.escapeShellArg dest}
    ${lib.optionalString privileged ''
      $DRY_RUN_CMD chown root:wheel ${lib.escapeShellArg dest}
      $DRY_RUN_CMD chmod 0555 ${lib.escapeShellArg dest}
    ''}
  '';
in
  delib.module {
    name = "system.tcc-stable-binaries";

    options = with delib;
      moduleOptions {
        enable = boolOption pkgs.stdenv.isDarwin;
        userDir = readOnly (strOption "${homeConfig.home.homeDirectory}/Library/Application Support/dotfiles/bin");
        systemDir = readOnly (strOption "/Library/Application Support/dotfiles/bin");
        entries = attrsOfOption entryType {};
      };

    myconfig.always = {cfg, ...}: {
      args.shared.tccStableBinaries = {
        inherit (cfg) userDir systemDir;
        resolved = lib.mapAttrs (destFor cfg) cfg.entries;
      };
    };

    # Feature modules contribute entries and point their own launchd/sudoers at
    # resolved.<name>. This module is the sole writer of the two destination
    # directories.
    home.ifEnabled = {cfg, ...}: let
      userEntries = lib.filterAttrs (_: entry: entry.scope == "user") cfg.entries;
      rsync = lib.getExe pkgs.rsync;
    in
      lib.mkIf (userEntries != {}) {
        home.activation.tccStableBinaries = homeConfig.lib.dag.entryBefore ["setupLaunchAgents"] (
          lib.concatStringsSep "\n" (
            [
              "echo 'copying TCC-stable user binaries...' >&2"
            ]
            ++ lib.mapAttrsToList (
              name: entry:
                copyFile {
                  inherit rsync;
                  inherit (entry) source;
                  dest = destFor cfg name entry;
                  privileged = false;
                }
            )
            userEntries
          )
        );
      };

    darwin.ifEnabled = {cfg, ...}: let
      systemEntries = lib.filterAttrs (_: entry: entry.scope == "system") cfg.entries;
      rsync = lib.getExe pkgs.rsync;
      copySystem = lib.concatStringsSep "\n" (
        lib.mapAttrsToList (
          name: entry:
            copyFile {
              inherit rsync;
              inherit (entry) source;
              dest = destFor cfg name entry;
              privileged = true;
            }
        )
        systemEntries
      );
    in {
      system.activationScripts.tccStableBinaries.text = ''
        echo "copying TCC-stable system binaries..." >&2
        DRY_RUN_CMD=
        ${lib.optionalString (systemEntries != {}) ''
          mkdir -p ${lib.escapeShellArg cfg.systemDir}
          chown root:wheel ${lib.escapeShellArg cfg.systemDir}
          chmod 0755 ${lib.escapeShellArg cfg.systemDir}
          ${copySystem}
        ''}

        # Leftover store symlinks from an older kanata-darwin layout. Only
        # remove links that still point into the Nix store.
        for stale in /Applications/kanata /Applications/kanata-vk-agent; do
          if [ -L "$stale" ]; then
            target=$(readlink "$stale")
            case "$target" in
              /nix/store/*)
                rm "$stale"
                ;;
            esac
          fi
        done
      '';
    };
  }
