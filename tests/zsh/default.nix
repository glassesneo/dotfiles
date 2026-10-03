{
  inputs,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # Every published Hjem configuration that renders zsh startup files.
  zshFiles = lib.concatLists (lib.mapAttrsToList
    (_: configuration:
      lib.filter
      (file: lib.hasSuffix "/.zshenv" file.target || lib.hasSuffix "/.zshrc" file.target)
      configuration.manifest.files)
    inputs.self.hjemConfigurations);

  # fsh downloads its theme at startup unless the configured FAST_WORK_DIR holds one.
  themeTargets = lib.concatLists (lib.mapAttrsToList
    (_: configuration:
      map (file: file.target)
      (lib.filter (file: lib.hasSuffix "/secondary_theme.zsh" file.target)
        configuration.manifest.files))
    inputs.self.hjemConfigurations);
in
  pkgs.runCommand "zsh-test" {
    sources = map (file: file.source) zshFiles;
    inherit themeTargets;
    nativeBuildInputs = [pkgs.zsh];
  } ''
    set -eu

    for source in $sources; do
      zsh -n "$source"

      workDir=$(sed -n 's/^FAST_WORK_DIR="\(.*\)"$/\1/p' "$source")
      if [ -n "$workDir" ]; then
        case " $themeTargets " in
          *" $workDir/secondary_theme.zsh "*) ;;
          *) echo "$source: no secondary_theme.zsh in $workDir" >&2; exit 1 ;;
        esac
      fi
    done

    mkdir "$out"
  ''
