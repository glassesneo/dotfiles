{
  delib,
  homeConfig,
  inputs,
  lib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.crush";

  options = delib.singleEnableOption false;

  home.always.imports = [
    inputs.charmbracelet.homeModules.crush
  ];

  home.ifEnabled = {
    programs.crush = {
      enable = true;
      package = llm-agents.crush;
      settings = {
        lsp = {
          biome = {
            enabled = true;
            command = "biome";
            # filetypes = ["ts" "tsx" "js" "jsx"];
          };
          deno = {
            enabled = true;
            command = "deno";
            args = ["lsp"];
            # filetypes = ["ts, tsx, js, jsx"];
          };
          lua = {
            enabled = true;
            command = "emmylua_ls";
            # filetypes = ["lua"];
          };
          nix = {
            enabled = true;
            command = "${lib.getExe pkgs.nixd}";
            # filetypes = ["nix"];
          };
          python = {
            enabled = true;
            command = "basedpypyright-langserver";
            args = ["--stdio"];
            # filetypes = ["py"];
          };
          typescript = {
            enabled = true;
            command = "typescript-language-server";
            args = ["--stdio"];
            # filetypes = ["ts" "tsx" "js" "jsx"];
          };
          zig = {
            enabled = true;
            command = "zls";
            # filetypes = ["zig" "zon"];
          };
        };
        options = {
          context_paths = ["${homeConfig.home.homeDirectory}/.claude/CLAUDE.md"];
        };
      };
    };
  };
}
