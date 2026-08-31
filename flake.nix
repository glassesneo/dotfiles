{
  description = "Modular configuration of Home Manager and Nix-Darwin with Denix";

  outputs = inputs @ {
    flake-parts,
    denix,
    nixpkgs,
    ...
  }: let
    inherit (nixpkgs) lib;
    homeManagerUser = "neo";
    riceNames = ["vivid" "clean"];

    filterConfigurationsByHostNames = hostNames: configs: let
      allowedHostNames = lib.concatMap (hostName:
        [hostName]
        ++ map (riceName: "${hostName}-${riceName}") riceNames)
      hostNames;
      configurationHostName = name: lib.last (lib.splitString "@" name);
    in
      lib.filterAttrs (name: _: builtins.elem (configurationHostName name) allowedHostNames) configs;

    mkConfigurations = moduleSystem:
      denix.lib.configurations rec {
        inherit moduleSystem;
        inherit homeManagerUser;

        paths = [
          ./hosts
          ./modules
          ./rices
        ];

        extensions = with denix.lib.extensions; [
          args
          (base.withConfig {
            args.enable = true;
            rices.enable = true;
            hosts = {
              type.types = ["laptop" "server" "virtual"];
              features.features = ["guiShell" "devCore"];
              features.defaultByHostType = {
                laptop = ["guiShell" "devCore"];
                server = ["devCore"];
                virtual = ["devCore"];
              };
              extraSubmodules = [
                (_: {
                  options = with denix.lib; {
                    tier = description (enumOption ["minimal" "basic" "standard" "full"] "standard") "Performance tier of this host. Ordered: minimal < basic < standard < full.";
                    hasNotch = description (boolOption false) "Whether this host has a display notch (e.g. MacBook Pro). Drives bar position and notch-aware layout defaults.";
                    builtInDisplayUuid = description (allowNull ((strOption null) // {type = lib.types.strMatching "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";})) "CoreGraphics display UUID for this host's built-in panel.";
                  };
                })
              ];
            };
          })
          overlays
        ];

        specialArgs = {
          inherit inputs moduleSystem homeManagerUser;
        };
      };

    allHomeConfigurations = mkConfigurations "home";

    darwinConfigurations =
      filterConfigurationsByHostNames ["seiran" "seiran-vm1"] (mkConfigurations "darwin");
  in
    flake-parts.lib.mkFlake {inherit inputs;} {
      imports = [inputs.treefmt-nix.flakeModule];

      systems = ["aarch64-darwin" "x86_64-linux" "aarch64-linux"];

      # ----------------------------------------------------------------
      # System-agnostic outputs: denix-generated configurations
      # ----------------------------------------------------------------
      flake = {
        # Keep Linux NixOS hosts out of the standard flake output so Darwin
        # `nix flake check` does not try to evaluate Linux-only derivations.
        # VM validation lives in `checks.aarch64-linux.nixos-seiran-vm0` below.
        nixosConfigurations = {};
        homeConfigurations =
          filterConfigurationsByHostNames ["seiran" "seiran-vm1"] allHomeConfigurations;
        inherit darwinConfigurations;
      };

      # ----------------------------------------------------------------
      # Per-system outputs
      # ----------------------------------------------------------------
      perSystem = {
        pkgs,
        system,
        lib,
        ...
      }: {
        packages = lib.optionalAttrs pkgs.stdenv.isLinux (
          {
            server-tools = import ./packages/server-tools.nix {inherit pkgs;};
          }
          // lib.optionalAttrs (system == "x86_64-linux") {
            nvim = allHomeConfigurations."ec2-user@cloud9".config.programs.nvf.finalPackage;
          }
        );

        treefmt = {
          projectRootFile = "flake.nix";

          programs.alejandra.enable = true;
          programs.shfmt.enable = true;

          settings.formatter.luafmt = {
            command = "${pkgs.emmylua-formatter}/bin/luafmt";
            options = ["--write"];
            includes = ["*.lua"];
          };
        };

        apps = let
          currentSystem = pkgs.stdenv.hostPlatform.system;
          piPackage = inputs.llm-agents.packages.${currentSystem}.pi;
          piVersion = piPackage.version;
          syncPiExtensionVersions = pkgs.writeShellApplication {
            name = "sync-pi-extension-versions";
            runtimeInputs = [pkgs.pnpm];
            text = ''
              package_dir="modules/programs/pi-coding-agent"

              if [[ ! -f "$package_dir/package.json" ]]; then
                echo "error: run this command from the dotfiles repository root" >&2
                exit 1
              fi

              cd "$package_dir"
              pnpm --config.frozen-lockfile=false add --save-dev --save-exact --lockfile-only \
                "@earendil-works/pi-ai@${piVersion}" \
                "@earendil-works/pi-coding-agent@${piVersion}" \
                "@earendil-works/pi-tui@${piVersion}"
            '';
          };
          fullValidation = pkgs.writeShellApplication {
            name = "check-full";
            runtimeInputs = [pkgs.nix pkgs.coreutils];
            text = builtins.replaceStrings ["@system@"] [system] (builtins.readFile ./checks/full-validation.sh);
          };
        in {
          sync-pi-extension-versions = {
            type = "app";
            program = lib.getExe syncPiExtensionVersions;
            meta.description = "Synchronize Pi extension package versions with the flake-provided Pi package.";
          };
          check-full = {
            type = "app";
            program = lib.getExe fullValidation;
            meta.description = "Run applicable checks, configuration contracts, and representative builds.";
          };
        };

        checks = let
          fileset = pkgs.lib.fileset;
          piSource = ./modules/programs/pi-coding-agent;
          piPnpm = pkgs.pnpm;
          piPnpmNativeBuildInputs = [pkgs.nodejs piPnpm pkgs.pnpmConfigHook];
          piPnpmDeps = pkgs.fetchPnpmDeps {
            pname = "pi-customizations-deps";
            version = "0";
            src = piSource;
            pnpm = piPnpm;
            fetcherVersion = 4;
            hash = "sha256-KljNp2wByjqQLmpon8DOccPxgyfQCzdj8bhL4I+jyUw=";
          };
          configurationSource = fileset.toSource {
            root = ./.;
            fileset = fileset.unions [
              ./flake.nix
              ./flake.lock
              ./.sops.yaml
              ./hosts
              ./modules
              ./rices
              ./secrets
            ];
          };
          configurationContractsRunner = pkgs.writers.writeNu "configuration-contracts" {
            makeWrapperArgs = [
              "--prefix"
              "PATH"
              ":"
              (lib.makeBinPath [pkgs.nix pkgs.nodejs pkgs.coreutils])
            ];
          } (builtins.readFile ./checks/configuration-contracts.nu);
          workspaceTestSource = fileset.toSource {
            root = ./modules/services/sketchybar/widgets/workspace;
            fileset = fileset.unions [
              ./modules/services/sketchybar/widgets/workspace/tests
              ./modules/services/sketchybar/widgets/workspace/handler.nu
              ./modules/services/sketchybar/widgets/workspace/providers/aerospace.nu
              ./modules/services/sketchybar/widgets/workspace/providers/rift.nu
              ./modules/services/sketchybar/widgets/workspace/rift-subscribe-on-start.sh
            ];
          };
          mediaTestSource = fileset.toSource {
            root = ./modules/services/sketchybar;
            fileset = fileset.unions [
              ./modules/services/sketchybar/colors.nu
              ./modules/services/sketchybar/widgets/media/handler.nu
              ./modules/services/sketchybar/widgets/media/service.nu
              ./modules/services/sketchybar/widgets/media/tests
            ];
          };
          notificationsTestSource = fileset.toSource {
            root = ./modules/services/sketchybar;
            fileset = fileset.unions [
              ./modules/services/sketchybar/colors.nu
              ./modules/services/sketchybar/widgets/notifications
            ];
          };
          piCustomizations = {
            pi-customizations = pkgs.stdenvNoCC.mkDerivation {
              pname = "pi-customizations-check";
              version = "0";
              src = piSource;
              pnpmDeps = piPnpmDeps;

              nativeBuildInputs = piPnpmNativeBuildInputs;
              dontBuild = true;
              doCheck = true;
              checkPhase = ''
                runHook preCheck
                pnpm run check
                runHook postCheck
              '';
              installPhase = ''
                runHook preInstall
                mkdir -p $out
                touch $out/success
                runHook postInstall
              '';
            };
          };

          repositoryConsistency = {
            repository-consistency =
              pkgs.runCommand "repository-consistency" {
                nativeBuildInputs = [pkgs.python3];
                src = ./.;
              } ''
                python ${./checks/repository-consistency.py} --self-test
                python ${./checks/repository-consistency.py} "$src"
                touch $out
              '';
          };

          fullValidationRunnerTests = {
            full-validation-runner-tests =
              pkgs.runCommand "full-validation-runner-tests" {
                nativeBuildInputs = [pkgs.bash pkgs.coreutils];
              } ''
                bash ${./checks/full-validation-test.sh} ${./checks/full-validation.sh}
                touch $out
              '';
          };
        in
          piCustomizations
          // repositoryConsistency
          // fullValidationRunnerTests
          // lib.optionalAttrs (system == "aarch64-darwin") {
            configuration-contracts = pkgs.stdenvNoCC.mkDerivation {
              pname = "configuration-contracts";
              version = "0";
              src = piSource;
              pnpmDeps = piPnpmDeps;
              CONFIGURATION_SOURCE = configurationSource;
              CONFIGURATION_FIXTURE = ./checks/fixtures/configuration-contracts.nix;

              nativeBuildInputs = piPnpmNativeBuildInputs;
              dontBuild = true;
              doCheck = true;
              checkPhase = ''
                runHook preCheck
                export HOME="$TMPDIR/home"
                mkdir -p "$HOME/.cache/nix"
                PACKAGE_ROOT="$PWD" ${configurationContractsRunner}
                runHook postCheck
              '';
              installPhase = ''
                runHook preInstall
                mkdir -p "$out"
                touch "$out/success"
                runHook postInstall
              '';
            };

            kanata-configs = let
              configurations = {
                rift-enabled = darwinConfigurations.seiran.config.services.kanata;
                rift-disabled = darwinConfigurations.seiran-clean.config.services.kanata;
              };
              checkCommands = lib.concatMapStringsSep "\n" (name: let
                configuration = configurations.${name};
              in ''
                echo "Checking ${name} Kanata configuration"
                ${lib.getExe configuration.package} --check --cfg ${configuration.configSource}
              '') (builtins.attrNames configurations);
            in
              pkgs.runCommand "kanata-configs" {} ''
                set -eu
                ${checkCommands}
                touch "$out"
              '';

            sketchybar-workspace-adapter-tests =
              pkgs.runCommand "sketchybar-workspace-adapter-tests" {
                nativeBuildInputs = [pkgs.nushell];
                src = workspaceTestSource;
              } ''
                cp -r "$src" workspace
                chmod -R u+w workspace
                cd workspace/tests
                nu default.nu
                bash listener-bootstrap.sh
                bash cluster-local-rebuild.sh
                bash rift-subscribe-on-start.sh
                touch $out
              '';

            sketchybar-media-hover-tests =
              pkgs.runCommand "sketchybar-media-hover-tests" {
                nativeBuildInputs = [pkgs.nushell];
                src = mediaTestSource;
              } ''
                cp -r "$src" sketchybar
                chmod -R u+w sketchybar
                cd sketchybar/widgets/media/tests
                bash default.sh
                bash service.sh
                touch $out
              '';

            sketchybar-notifications-tests =
              pkgs.runCommand "sketchybar-notifications-tests" {
                nativeBuildInputs = [pkgs.nushell];
                src = notificationsTestSource;
              } ''
                cp -r "$src" sketchybar
                chmod -R u+w sketchybar
                cd sketchybar/widgets/notifications/tests
                bash default.sh
                touch $out
              '';
          }
          // lib.optionalAttrs (system == "aarch64-linux") (let
            nixosConfigs = filterConfigurationsByHostNames ["seiran-vm0"] (mkConfigurations "nixos");
          in {
            # On the VM, `nix flake check` builds the NixOS system closure.
            # On incompatible systems, full validation performs evaluation only.
            nixos-seiran-vm0 = nixosConfigs.seiran-vm0.config.system.build.toplevel;
          });

        devShells = lib.optionalAttrs (system == "aarch64-darwin") (let
          dotfiles = pkgs.mkShellNoCC {
            name = "dotfiles";
            packages = with pkgs; [
              deno
              nodejs
              pnpm
              typescript-language-server
              emmylua-ls
              emmylua-check
              emmylua-formatter
              just
              nickel
              nushell
            ];
          };
        in {
          inherit dotfiles;
          default = dotfiles;
        });
      };
    };

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nur = {
      url = "github:nix-community/NUR";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    denix = {
      url = "github:yunfachi/denix";
      inputs = {
        nixpkgs.follows = "nixpkgs";
        home-manager.follows = "home-manager";
        nix-darwin.follows = "nix-darwin";
      };
    };
    adios.url = "github:llakala/lladios";

    adios-wrappers = {
      url = "github:llakala/adios-wrappers";
      inputs.adios.follows = "adios";
    };
    nvf = {
      url = "github:notashelf/nvf";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-nix = {
      url = "github:BatteredBunny/brew-nix";
      inputs = {
        nixpkgs.follows = "nixpkgs";
        brew-api.follows = "brew-api";
        nix-darwin.follows = "nix-darwin";
      };
    };
    brew-api = {
      url = "github:BatteredBunny/brew-api";
      flake = false;
    };
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    spicetify-nix.url = "github:Gerg-L/spicetify-nix";
    zeno-zsh = {
      url = "github:yuki-yano/zeno.zsh";
      flake = false;
    };
    skills-deployer = {
      url = "github:glassesneo/skills-deployer";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    vicinae = {
      url = "github:vicinaehq/vicinae";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    japanese-tech-writing-skill = {
      url = "git+https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d";
      flake = false;
    };
    cognitive-rhythm-writing-skill = {
      url = "git+https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432";
      flake = false;
    };
    tree-sitter-moonbit = {
      url = "github:moonbitlang/tree-sitter-moonbit/a5a7e0b9cb2db740cfcc4232b2f16493b42a0c82";
      flake = false;
    };
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
    };
    kanata-darwin = {
      url = "github:not-in-stock/kanata-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    rift = {
      url = "github:acsandmann/rift";
      flake = false;
    };
    media-control = {
      url = "git+https://github.com/ungive/media-control?submodules=1";
      flake = false;
    };
    various-wallpapers = {
      url = "github:andrewzn69/wallpapers";
      flake = false;
    };
    wallpapers = {
      url = "github:rose-pine/wallpapers";
      flake = false;
    };
    denops-plugins = {
      url = "github:glassesneo/denops-plugins.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
