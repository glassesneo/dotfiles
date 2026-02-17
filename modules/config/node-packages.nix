{
  delib,
  pkgs,
  ...
}: let
  nodePackages = pkgs.callPackage ../../node-packages {inherit pkgs;};

  # Kiri wrapper unchanged — npx due to tree-sitter build issues
  kiri-mcp-server-wrapper = pkgs.writeShellScriptBin "kiri-mcp-server" ''
    export PATH="${pkgs.nodejs}/bin:${pkgs.tree-sitter}/bin:$PATH"
    exec ${pkgs.nodejs}/bin/npx -y kiri-mcp-server@0.9.2 "$@"
  '';
in
  delib.module {
    name = "node-packages";

    myconfig.always.args.shared = {
      inherit nodePackages;
      nodePkgs = {
        "kiri-mcp-server" = kiri-mcp-server-wrapper;
      };
    };
  }
