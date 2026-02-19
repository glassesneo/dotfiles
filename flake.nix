{
  description = "Modular configuration of Home Manager and Nix-Darwin with Denix";

  outputs = {
    denix,
    nixpkgs,
    ...
  } @ inputs: let
    mkConfigurations = moduleSystem:
      denix.lib.configurations rec {
        inherit moduleSystem;
        homeManagerUser = "neo";

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
            hosts.features.features = ["guiShell" "windowManagement" "devCore"];
            hosts.features.defaultByHostType = {
              laptop = ["guiShell" "windowManagement" "devCore"];
              server = ["devCore"];
              virtual = ["devCore"];
            };
          })
          overlays
        ];

        specialArgs = {
          inherit inputs moduleSystem homeManagerUser;
        };
      };

    homeConfigs = mkConfigurations "home";
  in {
    # nixosConfigurations = mkConfigurations "nixos";
    homeConfigurations = homeConfigs;
    darwinConfigurations = mkConfigurations "darwin";

    checks.aarch64-darwin = let
      pkgs = nixpkgs.legacyPackages.aarch64-darwin;

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
      hmChecks // nixvimChecks;

    devShells.aarch64-darwin = let
      pkgs = nixpkgs.legacyPackages.aarch64-darwin;
    in rec {
      dotfiles = pkgs.mkShellNoCC {
        name = "dotfiles";
        packages = with pkgs;
          [
            bun
            deno
            # lua-language-server
            emmylua-ls
            nickel
            nls
            stylua
          ]
          ++ [
            inputs.bun2nix.packages.aarch64-darwin.default
          ];
      };
      default = dotfiles;
    };
  };

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
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
    mcp-hub = {
      url = "github:ravitemer/mcp-hub";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    mcphub-nvim = {
      url = "github:ravitemer/mcphub.nvim";
      inputs.nixpkgs.follows = "nixpkgs";
    };
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
    charmbracelet = {
      url = "github:charmbracelet/nur";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    agenix = {
      url = "github:ryantm/agenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    dpp-vim = {
      url = "github:Shougo/dpp.vim";
      flake = false;
    };
    dpp-ext-installer = {
      url = "github:Shougo/dpp-ext-installer";
      flake = false;
    };
    dpp-ext-lazy = {
      url = "github:Shougo/dpp-ext-lazy";
      flake = false;
    };
    dpp-ext-toml = {
      url = "github:Shougo/dpp-ext-toml";
      flake = false;
    };
    dpp-protocol-git = {
      url = "github:Shougo/dpp-protocol-git";
      flake = false;
    };
    skills-deployer = {
      url = "github:glassesneo/skills-deployer";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    anthropic-skills = {
      url = "github:anthropics/skills";
      flake = false;
    };
    ui-ux-pro-max = {
      url = "github:nextlevelbuilder/ui-ux-pro-max-skill";
      flake = false;
    };
    tree-sitter-moonbit = {
      url = "github:moonbitlang/tree-sitter-moonbit/a5a7e0b9cb2db740cfcc4232b2f16493b42a0c82";
      flake = false;
    };
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
    };
    various-wallpapers = {
      url = "github:andrewzn69/wallpapers";
      flake = false;
    };
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    catppuccin = {
      url = "github:catppuccin/nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
