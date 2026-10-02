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
            # standalone applies packages through current-profile; expose it on PATH.
            ({config, ...}: {
              environment.sessionVariables.PATH = lib.mkMerge [
                (lib.mkBefore ["${config.xdg.state.directory}/hjem/standalone/current-profile/bin"])
                (lib.mkAfter ["$PATH"])
              ];
            })
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

      # Hjem's per-user module imports nixpkgs' assertions module, so `assertions`
      # is already declared in this evaluation.
      failedAssertions = map (x: x.message) (lib.filter (x: !x.assertion) cfg.assertions);

      throwAssertions = res:
        if failedAssertions != []
        then throw "\nFailed assertions:\n${lib.concatStringsSep "\n" (map (x: "- ${x}") failedAssertions)}"
        else res;
    in
      throwAssertions {
        manifest = {
          version = 3;
          files = map hjemLib.fileToJson enabledFiles;
        };

        packages = map toString cfg.packages;

        inherit preflight;
      };
  };
}
