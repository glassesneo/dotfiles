{
  delib,
  pkgs,
  ...
}: let
  nodePkgsBase = pkgs.callPackage ../../node2nix {inherit pkgs;};

  # Create a custom kiri-mcp-server package that works around the tree-sitter download issue
  # by using npx which can use cached node_modules or install globally
  kiri-mcp-server-wrapper = pkgs.writeShellScriptBin "kiri-mcp-server" ''
    export PATH="${pkgs.nodejs}/bin:${pkgs.tree-sitter}/bin:$PATH"
    exec ${pkgs.nodejs}/bin/npx -y kiri-mcp-server@0.9.2 "$@"
  '';

  nodePkgs =
    nodePkgsBase
    // {
      "kiri-mcp-server" = kiri-mcp-server-wrapper;
    };
in
  delib.module {
    name = "node2nix";

    myconfig.always.args.shared.nodePkgs = nodePkgs;
  }
