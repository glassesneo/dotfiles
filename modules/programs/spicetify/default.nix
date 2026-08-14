{
  delib,
  host,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}: let
  spicePkgs = inputs.spicetify-nix.legacyPackages.${pkgs.stdenv.hostPlatform.system};
in
  delib.module {
    name = "programs.spicetify";

    options = with delib;
      moduleOptions {
        enable = boolOption host.guiShellFeatured;
      };

    home.always.imports = [inputs.spicetify-nix.homeManagerModules.spicetify];

    myconfig.always.args.shared.spicePkgs = spicePkgs;

    home.ifEnabled = {
      programs.spicetify = {
        enable = true;
      };
      home.activation.disableSpotifyUpdates =
        lib.mkIf pkgs.stdenv.hostPlatform.isDarwin
        (homeConfig.lib.dag.entryAfter ["writeBoundary"] ''
          SPOTIFY_UPDATE_DIR="$HOME/Library/Application Support/Spotify/PersistentCache/Update"

          if ! /usr/bin/stat -f "%Sf" "$SPOTIFY_UPDATE_DIR" 2>/dev/null \
            | /usr/bin/grep -q uchg; then
            /bin/rm -rf "$SPOTIFY_UPDATE_DIR"
            /bin/mkdir -p "$SPOTIFY_UPDATE_DIR"
            /usr/bin/chflags uchg "$SPOTIFY_UPDATE_DIR"
          fi
        '');
    };
  }
