{inputs, ...}: {
  moduleSystems.hjem = {
    flakeOutputs = {
      modules = null;
      systems = null;
    };

    makeSystem = {
      modules,
      extraArgs,
      ...
    }: let
      inherit (extraArgs) system username homeDirectory;
      lib = inputs.nixpkgs.lib;
      pkgs = inputs.nixpkgs.legacyPackages.${system};
      hjemLib = inputs.hjem."hjem-lib".${system};

      evaluation = lib.evalModules {
        class = "hjem";

        specialArgs = {
          inherit pkgs;
          "hjem-lib" = hjemLib;
        };

        modules =
          [
            "${inputs.hjem.outPath}/modules/common/user.nix"
            {
              _module.args.name = username;
              user = username;
              directory = homeDirectory;
              clobberFiles = false;
            }
          ]
          ++ modules;
      };

      cfg = evaluation.config;

      fileSets = [
        cfg.files
        cfg.xdg.cache.files
        cfg.xdg.config.files
        cfg.xdg.data.files
        cfg.xdg.state.files
      ];

      enabledFiles =
        lib.concatMap
        (attrs:
          lib.filter (file: file.enable)
          (builtins.attrValues attrs))
        fileSets;

      sources =
        lib.filter
        (source: source != null)
        (map (file: file.source) enabledFiles);

      dependencies = sources ++ cfg.packages;

      preflight =
        pkgs.runCommand
        "hjem-preflight"
        {inherit dependencies;}
        ''
          for dependency in $dependencies; do
            test -e "$dependency"
            printf '%s\n' "$dependency"
          done > "$out"
        '';
    in {
      manifest = {
        version = 3;
        files = map hjemLib.fileToJson enabledFiles;
      };

      packages = map toString cfg.packages;

      inherit preflight;
    };
  };
}
