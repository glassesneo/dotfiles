{
  pkgs,
  config,
  inputs,
  lib,
  ...
}: let
  npx = pkgs.lib.getExe' pkgs.nodejs "npx";
  uvx = pkgs.lib.getExe' pkgs.uv "uvx";
  mcpServersConfig = inputs.mcp-servers-nix.lib.mkConfig pkgs {
    programs = {
      filesystem = {
        enable = true;
        args = [
          "${config.home.homeDirectory}/.dotfiles"
        ];
        type = "stdio";
      };
      git.enable = true;
      github = {
        enable = true;
        passwordCommand = {
          GITHUB_PERSONAL_ACCESS_TOKEN = [
            (lib.getExe config.programs.gh.package)
            "auth"
            "token"
          ];
        };
        type = "stdio";
      };
      # fetch.enable = true;
      context7 = {
        enable = true;
        type = "stdio";
      };
      playwright = {
        enable = true;
        type = "stdio";
      };
      memory = {
        enable = true;
        env = {
          MEMORY_FILE_PATH = "${config.xdg.dataHome}/mcp_memory.json";
        };
        type = "stdio";
      };
      sequential-thinking = {
        enable = true;
        type = "stdio";
      };
      # time.enable = true;
    };
    settings.servers = {
      brave-search = {
        command = "${npx}";
        args = [
          "-y"
          "@modelcontextprotocol/server-brave-search"
        ];
        passwordCommand = {
          BRAVE_API_KEY = ["${lib.getExe' pkgs.coreutils "cat"}" "${config.age.secrets.brave-api-key.path}"];
        };
      };
      calculator = {
        command = "${uvx}";
        args = ["mcp-server-calculator"];
      };
      deepwiki = {
        url = "https://mcp.deepwiki.com/mcp";
        type = "sse";
      };
      youtube = {
        command = "${npx}";
        args = [
          "-y"
          "@anaisbetts/mcp-youtube"
        ];
      };
      arxiv = {
        command = "${uvx}";
        args = [
          "arxiv-mcp-server"
          "--storage-path"
          "${config.xdg.dataHome}/mcp_arxiv_storage"
        ];
      };
      readability = {
        command = "${npx}";
        args = [
          "-y"
          "@mizchi/readability"
          "--mcp"
        ];
      };
    };
  };
  mcpServers = [
    {
      home.packages = [
        pkgs.yt-dlp
      ];
      home.file = {
        "${config.xdg.configHome}/mcphub/servers.json".source = mcpServersConfig;
      };
    }
  ];
in {
  imports = mcpServers;
}
