# Owns the Hjem module system and the contract of its result.
#
# `makeSystem` evaluates one user's Hjem configuration and returns the manifest,
# the packages, `serviceApply` (bin/apply), and a `preflight` derivation that
# realizes all file, package and service closures. Assertions block every output.
#
# A file declared with `exclusive = true` in any file set (`files` or
# `xdg.<kind>.files`) must be defined from one location; a second module or host
# defining it fails through the assertions. Locations are the origin labels of
# `extensions/provenance.nix`.
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

      fileSetPaths = [
        ["files"]
        ["xdg" "cache" "files"]
        ["xdg" "config" "files"]
        ["xdg" "data" "files"]
        ["xdg" "state" "files"]
      ];

      # Hjem merges `text` definitions silently, so exclusivity counts definition
      # locations, excluding Hjem's own defaults at the option declarations.
      exclusiveFiles = {config, ...}: let
        fileExtension = {options, ...}: {
          options = {
            exclusive = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether a single location must define this file.";
            };
            definers = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              internal = true;
              readOnly = true;
              description = "Locations defining this file, excluding option declarations.";
            };
          };

          config.definers = lib.unique (lib.concatMap
            (option:
              map (definition: definition.file)
              (lib.filter
                (definition: !(lib.elem definition.file option.declarations))
                option.definitionsWithLocations))
            (lib.collect lib.isOption (builtins.removeAttrs options ["_module" "exclusive" "definers"])));
        };
      in {
        options = lib.foldl' lib.recursiveUpdate {} (map
          (path:
            lib.setAttrByPath path (lib.mkOption {
              type = lib.types.attrsOf (lib.types.submodule fileExtension);
            }))
          fileSetPaths);

        config.assertions = lib.concatMap (path:
          lib.mapAttrsToList (name: file: {
            assertion = !file.exclusive || builtins.length file.definers <= 1;
            message = "${lib.concatStringsSep "." path}.\"${name}\" is exclusive but defined by: ${lib.concatStringsSep ", " file.definers}";
          })
          (lib.getAttrFromPath path config))
        fileSetPaths;
      };

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
            exclusiveFiles
            ./services.nix
            (import ./nix-secrets.nix {inherit inputs;})
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

      fileSets = map (path: lib.getAttrFromPath path cfg) fileSetPaths;

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

      dependencies = sources ++ cfg.packages ++ [cfg.serviceApply];

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
        serviceApply = cfg.serviceApply;
      };
  };
}
