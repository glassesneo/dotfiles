{
  delib,
  inputs,
  pkgs,
  ...
}: let
  media-control = pkgs.stdenv.mkDerivation {
    name = "media-control";
    pname = "media-control";

    src = inputs.media-control;

    nativeBuildInputs = with pkgs; [
      cmake
      perl
    ];

    buildInputs = [
      pkgs.apple-sdk_15
    ];

    postPatch = ''
      # Build only for the host architecture (upstream hardcodes universal)
      substituteInPlace mediaremote-adapter/CMakeLists.txt \
        --replace-fail 'set(CMAKE_OSX_ARCHITECTURES "x86_64;arm64")' \
                       'set(CMAKE_OSX_ARCHITECTURES "${pkgs.stdenv.hostPlatform.darwinArch}")'
      # Replace codesign with no-op (sigtool can't handle framework bundles)
      substituteInPlace mediaremote-adapter/CMakeLists.txt \
        --replace-fail 'codesign --force --deep --sign -' \
                       'true #'
    '';

    cmakeFlags = [
      "-DCMAKE_INSTALL_PREFIX=${placeholder "out"}"
    ];

    meta = with pkgs.lib; {
      description = "Control and observe media playback from the command line";
      homepage = "https://github.com/ungive/media-control";
      license = licenses.unfree;
      platforms = platforms.darwin;
    };
  };
in
  delib.module {
    name = "programs.media-control";

    options = with delib;
      moduleOptions {
        enable = boolOption false;
        package = readOnly (packageOption media-control);
      };

    home.ifEnabled = {cfg, ...}: {
      home.packages = [
        cfg.package
      ];
    };
  }
