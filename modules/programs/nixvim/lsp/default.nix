{
  config,
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp";

  options = delib.singleEnableOption true;

  myconfig.always.args.shared.nixvimLsp = let
    defaultServer = {
      enable = true;
      package = null;
      activate = false;
    };
    serverLevelKeys = ["activate" "package"];
    mkServer = args: let
      serverAttrs = lib.filterAttrs (name: _: builtins.elem name serverLevelKeys) args;
      configAttrs = removeAttrs args serverLevelKeys;
    in
      defaultServer
      // serverAttrs
      // lib.optionalAttrs (configAttrs != {}) {config = configAttrs;};
    pathGatedExecutables = {
      basedpyright = "basedpyright-langserver";
      biome = "biome";
      elmls = "elm-language-server";
      gopls = "gopls";
      hls = "haskell-language-server-wrapper";
      kotlin_language_server = "kotlin-language-server";
      marksman = "marksman";
      nim_langserver = "nimlangserver";
      nushell = "nu";
      prismals = "prisma-language-server";
      taplo = "taplo";
      tinymist = "tinymist";
      zls = "zls";
    };
  in {
    inherit defaultServer mkServer pathGatedExecutables;
  };

  home.ifEnabled.programs.nixvim = let
    pathGatedExecutables = config.myconfig.args.shared.nixvimLsp.pathGatedExecutables;
    luaPayload = [
      ''
        local path_gated_executables = vim.json.decode([[${builtins.toJSON pathGatedExecutables}]])
      ''
      (builtins.readFile ./servers-lua-only.lua)
      (builtins.readFile ./exceptions.lua)
      (builtins.readFile ./activation.lua)
    ];
  in {
    lsp = {
      inlayHints.enable = true;
    };
    plugins = {
      lspconfig.enable = true;
    };
    extraConfigLuaPost = lib.concatStringsSep "\n\n" luaPayload;
  };
}
