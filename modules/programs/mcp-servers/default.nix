{
  delib,
  homeConfig,
  inputs,
  lib,
  nodePkgs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.mcp-servers-nix";

  options.programs.mcp-servers-nix = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = let
    # The syntax follows https://github.com/ravitemer/mcphub.nvim/blob/8ff40b5edc649959bb7e89d25ae18e055554859a/doc/mcp/servers_json.md
    mcphub-servers = {
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
        # context7 = {
        # enable = true;
        # type = "stdio";
        # };
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
      settings.servers = {
        brave-search = {
          command = "${pkgs.lib.getExe' nodePkgs."@brave/brave-search-mcp-server" "brave-search-mcp-server"}";
          # args = [
          # "-y"
          # ""
          # ];
          env = {
            BRAVE_API_KEY = ''''${env:BRAVE_API_KEY}'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/mcp";
          type = "sse";
        };
        notion = {
          url = "https://mcp.notion.com/mcp";
        };
        readability = {
          command = "${pkgs.lib.getExe pkgs.nodejs}";
          args = [
            "${nodePkgs."@mizchi/readability"}/lib/node_modules/@mizchi/readability/dist/mcp.js"
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
          command = "${pkgs.lib.getExe' nodePkgs."tavily-mcp" "tavily-mcp"}";
          env = {
            TAVILY_API_KEY = ''''${env:TAVILY_API_KEY}'';
          };
        };
        # cerebras = {
        # command = "${npx}";
        # args = [
        # "-y"
        # "cerebras-code-mcp@latest"
        # ];
        # env = {
        # CEREBRAS_API_KEY = ''''${cmd: ${cat} ${homeConfig.age.secrets.cerebras-api-key.path}}'';
        # };
        # };
        # serena = {
        # command = "${uvx}";
        # args = [
        # "--from"
        # "git+https://github.com/oraios/serena"
        # "serena-mcp-server"
        # ];
        # };
        # youtube = {
        # command = "${npx}";
        # args = [
        # "-y"
        # "@anaisbetts/mcp-youtube"
        # ];
        # };
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
      };
    };
    # The syntax follows https://docs.claude.com/en/docs/claude-code/mcp
    claude-code-servers = {
      programs = {
        git.enable = true;
        # fetch.enable = true;
        # context7 = {
        # enable = true;
        # type = "stdio";
        # };
        playwright = {
          enable = true;
          type = "stdio";
        };
        # memory = {
        # enable = true;
        # env = {
        # MEMORY_FILE_PATH = "${homeConfig.xdg.dataHome}/mcp_memory.json";
        # };
        # type = "stdio";
        # };
        time.enable = true;
      };
      settings.servers = {
        brave-search = {
          command = "${pkgs.lib.getExe' nodePkgs."@brave/brave-search-mcp-server" "brave-search-mcp-server"}";
          env = {
            BRAVE_API_KEY = ''''${BRAVE_API_KEY}'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/sse";
          type = "sse";
        };
        readability = {
          command = "${pkgs.lib.getExe pkgs.nodejs}";
          args = [
            "${nodePkgs."@mizchi/readability"}/lib/node_modules/@mizchi/readability/dist/mcp.js"
          ];
        };
        tavily = {
          command = "${pkgs.lib.getExe' nodePkgs."tavily-mcp" "tavily-mcp"}";
          env = {
            TAVILY_API_KEY = ''''${TAVILY_API_KEY}'';
          };
        };
      };
    };
  in {
    home.packages = [
      # pkgs.yt-dlp
    ];
    home.file = {
      "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs mcphub-servers;
    };
    programs.claude-code.mcpServers = lib.mkIf homeConfig.programs.claude-code.enable (inputs.mcp-servers-nix.lib.evalModule pkgs claude-code-servers).config.settings.servers;
  };
}
