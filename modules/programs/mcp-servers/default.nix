{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.mcp-servers-nix";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = [
      pkgs.yt-dlp
    ];
    home.file = {
      "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs {
        programs = {
          filesystem = {
            # enable = true;
            args = [
              "${homeConfig.home.homeDirectory}/.dotfiles"
            ];
            type = "stdio";
          };
          git.enable = true;
          github = {
            enable = true;
            passwordCommand = {
              GITHUB_PERSONAL_ACCESS_TOKEN = [
                (lib.getExe homeConfig.programs.gh.package)
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
              MEMORY_FILE_PATH = "${homeConfig.xdg.dataHome}/mcp_memory.json";
            };
            type = "stdio";
          };
          sequential-thinking = {
            enable = true;
            type = "stdio";
          };
          time.enable = true;
        };
        settings.servers = let
          cat = pkgs.lib.getExe' pkgs.coreutils "cat";
          npx = pkgs.lib.getExe' pkgs.nodejs "npx";
          uvx = pkgs.lib.getExe' pkgs.uv "uvx";
        in {
          brave-search = {
            command = "${npx}";
            args = [
              "-y"
              "@modelcontextprotocol/server-brave-search"
            ];
            env = {
              BRAVE_API_KEY = ''''${cmd: ${cat} ${homeConfig.age.secrets.brave-api-key.path}}'';
            };
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
          # arxiv = {
          # command = "${uvx}";
          # args = [
          # "arxiv-mcp-server"
          # "--storage-path"
          # "${homeConfig.xdg.dataHome}/mcp_arxiv_storage"
          # ];
          # };
          # meilisearch = {
          # command = "${uvx}";
          # args = [
          # "-n"
          # "meilisearch-mcp"
          # ];
          # };
          notion = {
            url = "https://mcp.notion.com/mcp";
          };
          readability = {
            command = "${npx}";
            args = [
              "-y"
              "@mizchi/readability"
              "--mcp"
            ];
          };
          relative-filesystem = {
            command = "${lib.getExe pkgs.deno}";
            args = [
              "run"
              "-A"
              "/Users/neo/dev/relative-filesystem-mcp/server.ts"
            ];
          };
          tavily = {
            command = "${npx}";
            args = [
              "-y"
              "tavily-mcp@latest"
            ];
            env = {
              TAVILY_API_KEY = ''''${cmd: ${cat} ${homeConfig.age.secrets.tavily-api-key.path}}'';
            };
          };
          # serena = {
          # command = "${uvx}";
          # args = [
          # "--from"
          # "git+https://github.com/oraios/serena"
          # "serena-mcp-server"
          # ];
          # };
        };
      };
    };
  };
}
