{inputs, ...}:
inputs.nix-darwin.lib.darwinSystem {
  system = "aarch64-darwin";
  inherit inputs;
  specialArgs = {
    inherit inputs;
    hostName = "macos-personal-laptop-01";
  };
  modules = [
    ../system/darwin
    inputs.brew-nix.darwinModules.default
    ../module/brew-nix
    inputs.nixvim.nixDarwinModules.nixvim
    ../module/nixvim
    inputs.home-manager.darwinModules.home-manager
    {
      home-manager = {
        useGlobalPkgs = true;
        useUserPackages = true;
        extraSpecialArgs = {
          inherit inputs;
        };
        verbose = true;
        sharedModules = [];
        users.neo = {
          pkgs,
          lib,
          config,
          ...
        }: {
          home = {
            username = "neo";
            homeDirectory = lib.mkForce "/Users/neo";
            stateVersion = "24.11";
            packages = with pkgs; [
              bat
              btop
              coreutils
              devbox
              duf
              fastfetch
              fd
              jq
              nowplaying-cli
              ripgrep
              skim
              sl
              tdf
              unrar
              uv
              vim-startuptime
              xz
            ];
          };

          xdg.enable = true;
          programs.home-manager.enable = true;

          imports = [
            inputs.agenix.homeManagerModules.default
            ../home/common/direnv.nix
            ../home/common/git.nix
            ../home/common/gh.nix
            ../home/common/eza.nix
            ../home/common/nixvim.nix
            ../home/common/oh-my-posh.nix
            ../home/common/yazi.nix
            ../home/common/zed-editor.nix
            # ../home/common/zellij.nix
            # ../home/common/starship.nix
            ../home/common/zsh.nix
            ../home/darwin/nushell.nix
            ../home/darwin/ghostty.nix
            ../home/darwin/kitty.nix
            ../home/darwin/services.nix
          ];
          age.identityPaths = ["/Users/neo/.ssh/id_agenix"];
          age.secrets.gemini-api-key.file = ../secrets/gemini-api-key.age;
          home.sessionVariables = {
            GEMINI_API_KEY = ''$(${pkgs.coreutils}/bin/cat ${config.age.secrets.gemini-api-key.path})'';
          };
        };
      };
    }
  ];
}
