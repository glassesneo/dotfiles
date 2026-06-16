{
  description = "Modular configuration of Home Manager and Nix-Darwin with Denix";

  outputs = inputs @ {
    flake-parts,
    denix,
    nixpkgs,
    ...
  }: let
    lib = nixpkgs.lib;
    homeManagerUser = "neo";
    riceNames = ["catppuccin" "everforest" "monochrome"];

    filterConfigurationsByHostNames = hostNames: configs: let
      hostConfigurationNames = hostName:
        [hostName]
        ++ map (riceName: "${hostName}-${riceName}") riceNames;

      homeConfigurationNames = hostName:
        ["${homeManagerUser}@${hostName}"]
        ++ map (riceName: "${homeManagerUser}@${hostName}-${riceName}") riceNames;

      allowedNames = lib.concatMap (hostName:
        hostConfigurationNames hostName ++ homeConfigurationNames hostName)
      hostNames;
    in
      lib.filterAttrs (name: _: builtins.elem name allowedNames) configs;

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
            hosts.type.types = ["laptop" "server" "virtual"];
            hosts.features.features = ["guiShell" "devCore"];
            hosts.features.defaultByHostType = {
              laptop = ["guiShell" "devCore"];
              server = ["devCore"];
              virtual = ["devCore"];
            };
            hosts.extraSubmodules = [
              ({lib, ...}: {
                options.tier = lib.mkOption {
                  type = lib.types.enum ["minimal" "basic" "standard" "full"];
                  default = "standard";
                  description = "Performance tier of this host. Ordered: minimal < basic < standard < full.";
                };
                options.hasNotch = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                  description = "Whether this host has a display notch (e.g. MacBook Pro). Drives bar position and notch-aware layout defaults.";
                };
              })
            ];
          })
          overlays
        ];

        specialArgs = {
          inherit inputs moduleSystem homeManagerUser;
        };
      };
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
          filterConfigurationsByHostNames ["seiran" "kurogane"] (mkConfigurations "home");
        darwinConfigurations =
          filterConfigurationsByHostNames ["seiran" "kurogane"] (mkConfigurations "darwin");
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
        treefmt = import ./treefmt.nix {inherit pkgs;};

        checks =
          lib.optionalAttrs (system == "aarch64-darwin") (let
            homeConfigs = inputs.self.homeConfigurations;

            hmChecks =
              pkgs.lib.mapAttrs' (name: config: {
                name = "hm-" + builtins.replaceStrings ["@"] ["_at_"] name;
                value = config.activationPackage;
              })
              homeConfigs;

            nixvimChecks =
              pkgs.lib.mapAttrs' (name: config: {
                name = "nixvim-" + builtins.replaceStrings ["@"] ["_at_"] name;
                value = config.config.programs.nixvim.build.test;
              }) (pkgs.lib.filterAttrs (
                  name: _:
                    name == "neo@kurogane" || name == "neo@kurogane-catppuccin"
                )
                homeConfigs);
          in
            hmChecks
            // nixvimChecks)
          // lib.optionalAttrs (system == "aarch64-linux") (let
            nixosConfigs = filterConfigurationsByHostNames ["seiran-vm0"] (mkConfigurations "nixos");
          in {
            # On the VM, `nix flake check` builds the NixOS system closure.
            # On Darwin, this check is omitted as an incompatible system.
            nixos-seiran-vm0 = nixosConfigs.seiran-vm0.config.system.build.toplevel;
          });

        devShells = lib.optionalAttrs (system == "aarch64-darwin") (let
          dotfiles = pkgs.mkShellNoCC {
            name = "dotfiles";
            packages = with pkgs;
              [
                bun
                deno
                emmylua-ls
                just
                nickel
                stylua
              ]
              ++ [
                inputs.bun2nix.packages.aarch64-darwin.default
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
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
      inputs.nix-darwin.follows = "nix-darwin";
    };
    nixvim = {
      url = "github:nix-community/nixvim/main";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nvf = {
      url = "github:notashelf/nvf";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # neovim-nightly-overlay = {
    # url = "github:nix-community/neovim-nightly-overlay";
    # inputs.nixpkgs.follows = "nixpkgs";
    # };
    mcp-servers-nix = {
      url = "github:natsukium/mcp-servers-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-nix = {
      url = "github:BatteredBunny/brew-nix";
      inputs.nix-darwin.follows = "nix-darwin";
      inputs.brew-api.follows = "brew-api";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-api = {
      url = "github:BatteredBunny/brew-api";
      flake = false;
    };
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    zeno-zsh = {
      url = "github:yuki-yano/zeno.zsh";
      flake = false;
    };
    skills-deployer = {
      url = "github:glassesneo/skills-deployer";
      inputs.nixpkgs.follows = "nixpkgs";
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
    zed-extensions = {
      url = "github:DuskSystems/nix-zed-extensions";
    };
    various-wallpapers = {
      url = "github:andrewzn69/wallpapers";
      flake = false;
    };
    wallpapers = {
      url = "github:rose-pine/wallpapers";
      flake = false;
    };
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    denops-plugins = {
      url = "github:glassesneo/denops-plugins.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    catppuccin = {
      url = "github:catppuccin/nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
