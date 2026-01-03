{
  delib,
  host,
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
    codex = pkgs.lib.getExe' homeConfig.programs.codex.package "codex";
    deno = pkgs.lib.getExe pkgs.deno;
    nodejs = pkgs.lib.getExe pkgs.nodejs;
    readability-mcp = "${nodePkgs."@mizchi/readability"}/lib/node_modules/@mizchi/readability/dist/mcp.js";
    brave-search-mcp = pkgs.lib.getExe' nodePkgs."@brave/brave-search-mcp-server" "brave-search-mcp-server";
    tavily-mcp = pkgs.lib.getExe' nodePkgs."tavily-mcp" "tavily-mcp";
    chrome-devtools-mcp = pkgs.lib.getExe' nodePkgs."chrome-devtools-mcp" "chrome-devtools-mcp";
    fast-apply-mcp = pkgs.lib.getExe' nodePkgs."@morph-llm/morph-fast-apply" "mcp-server-filesystem";
    kiri-mcp = pkgs.lib.getExe' nodePkgs."kiri-mcp-server" "kiri-mcp-server";
    google-map-mcp = pkgs.lib.getExe' nodePkgs."@modelcontextprotocol/server-google-maps" "mcp-server-google-maps";
    # mcp-git = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.mcp-server-git;
    # mcp-time = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.mcp-server-time;
    # mcp-memory = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.mcp-server-memory;
    # mcp-sequential-thinking = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.mcp-server-sequential-thinking;
    mcp-context7 = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
    # The syntax follows https://github.com/ravitemer/mcphub.nvim/blob/main/doc/mcp/servers_json.md
    mcphub-servers = {
      programs = {
        filesystem = {
          # enable = true;
          args = [
            "${homeConfig.home.homeDirectory}/.dotfiles"
          ];
          type = "stdio";
        };
        # git.enable = true;
        github = {
          # enable = true;
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
        # playwright = {
        # enable = true;
        # type = "stdio";
        # };
        # memory = {
        # enable = true;
        # env = {
        # MEMORY_FILE_PATH = "${homeConfig.xdg.dataHome}/codecompanion_memory.json";
        # };
        # type = "stdio";
        # };
        sequential-thinking = {
          # enable = true;
          type = "stdio";
        };
        # time.enable = true;
      };
      settings.servers = {
        brave-search = {
          command = "${brave-search-mcp}";
          env = {
            BRAVE_API_KEY = ''''${env:BRAVE_API_KEY}'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/mcp";
          type = "sse";
        };
        # notion = {
        # url = "https://mcp.notion.com/mcp";
        # };
        readability = {
          command = "${nodejs}";
          args = [
            "${readability-mcp}"
          ];
        };
        relative-filesystem = {
          command = "${deno}";
          args = [
            "run"
            "-A"
            "/Users/neo/dev/relative-filesystem-mcp/server.ts"
          ];
        };
        tavily = {
          command = "${tavily-mcp}";
          env = {
            TAVILY_API_KEY = ''''${env:TAVILY_API_KEY}'';
          };
        };
        chrome-devtools = {
          command = "${chrome-devtools-mcp}";
        };
        morph-fast-apply = {
          command = "${fast-apply-mcp}";
          env = {
            ALL_TOOLS = "false";
            MORPH_API_KEY = ''''${env:MORPH_API_KEY}'';
          };
        };
        kiri = {
          command = "${kiri-mcp}";
          args = ["--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
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
        context7 = {
          enable = true;
          type = "stdio";
        };
        # memory = {
        # enable = true;
        # env = {
        # MEMORY_FILE_PATH = "${homeConfig.xdg.dataHome}/claudecode_memory.json";
        # };
        # type = "stdio";
        # };
      };
      settings.servers = {
        codex = {
          command = "${codex}";
          args = ["mcp-server"];
        };
        brave-search = {
          command = "${brave-search-mcp}";
          env = {
            BRAVE_API_KEY = ''''${BRAVE_API_KEY}'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/sse";
          type = "sse";
        };
        readability = {
          command = "${nodejs}";
          args = [
            "${readability-mcp}"
          ];
        };
        # tavily = {
        # command = "${tavily-mcp}";
        # env = {
        # TAVILY_API_KEY = ''''${TAVILY_API_KEY}'';
        # };
        # };
        # chrome-devtools = {
        # command = "${chrome-devtools-mcp}";
        # };
        morph-fast-apply = {
          command = "${fast-apply-mcp}";
          env = {
            ALL_TOOLS = "false";
            MORPH_API_KEY = ''''${MORPH_API_KEY}'';
          };
        };
        kiri = {
          command = "${kiri-mcp}";
          args = ["--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
        };
        # google-map-mcp = {
        # command = "${google-map-mcp}";
        # env = {
        # GOOGLE_MAPS_API_KEY = ''''${GOOGLE_CLOUD_API_KEY}'';
        # };
        # };
      };
    };
    claude-desktop-servers = {
      programs = {
        context7 = {
          enable = true;
          type = "stdio";
        };
      };
      settings.servers = {
        brave-search = {
          command = "${brave-search-mcp}";
          env = {
            BRAVE_API_KEY = ''''${BRAVE_API_KEY}'';
          };
        };
        readability = {
          command = "${nodejs}";
          args = [
            "${readability-mcp}"
          ];
        };
        # tavily = {
        # command = "${tavily-mcp}";
        # env = {
        # TAVILY_API_KEY = ''''${TAVILY_API_KEY}'';
        # };
        # };
        chrome-devtools = {
          command = "${chrome-devtools-mcp}";
        };
        google-map-mcp = {
          command = "${google-map-mcp}";
          env = {
            GOOGLE_MAPS_API_KEY = ''''${GOOGLE_CLOUD_API_KEY}'';
          };
        };
      };
    };
    codex-servers = {
      programs = {
        # git.enable = true;
        # time.enable = true;
        context7 = {
          enable = true;
          type = "stdio";
        };
      };
      settings.servers = {
        brave-search = {
          command = "${brave-search-mcp}";
          env_vars = ["BRAVE_API_KEY"];
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/mcp";
        };
        readability = {
          command = "${nodejs}";
          args = [
            "${readability-mcp}"
          ];
        };
        # tavily = {
        # command = "${tavily-mcp}";
        # env_vars = ["TAVILY_API_KEY"];
        # };
        chrome-devtools = {
          command = "${chrome-devtools-mcp}";
        };
        morph-fast-apply = {
          command = "${fast-apply-mcp}";
          env = {
            ALL_TOOLS = "false";
          };
          env_vars = ["MORPH_API_KEY"];
        };
        kiri = {
          command = "${kiri-mcp}";
          args = ["--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
        };
      };
    };
    crush-servers = {
      programs = {
        context7 = {
          enable = true;
          type = "stdio";
        };
      };
      settings.servers = {
        codex = {
          command = "${codex}";
          args = ["mcp-server"];
        };
        brave-search = {
          command = "${brave-search-mcp}";
          env = {
            BRAVE_API_KEY = ''$BRAVE_API_KEY'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/sse";
          type = "sse";
        };
        readability = {
          command = "${nodejs}";
          args = [
            "${readability-mcp}"
          ];
        };
        # tavily = {
        # command = "${tavily-mcp}";
        # env = {
        # TAVILY_API_KEY = ''$TAVILY_API_KEY'';
        # };
        # };
        # chrome-devtools = {
        # command = "${chrome-devtools-mcp}";
        # };
        morph-fast-apply = {
          command = "${fast-apply-mcp}";
          env = {
            ALL_TOOLS = "false";
            MORPH_API_KEY = ''$MORPH_API_KEY'';
          };
        };
        kiri = {
          command = "${kiri-mcp}";
          args = ["--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
        };
      };
    };
    # The syntax follows https://opencode.ai/docs/mcp-servers
    opencode-servers = {
      settings.servers = {
        context7 = {
          command = ["${mcp-context7}"];
          type = "local";
        };
        codex = {
          command = ["${codex}" "mcp-server"];
          type = "local";
        };
        brave-search = {
          command = ["${brave-search-mcp}"];
          type = "local";
          environment = {
            BRAVE_API_KEY = ''{env:BRAVE_API_KEY}'';
          };
        };
        deepwiki = {
          url = "https://mcp.deepwiki.com/sse";
          type = "remote";
        };
        readability = {
          command = ["${nodejs}" "${readability-mcp}"];
          type = "local";
        };
        # tavily = {
        # command = ["${tavily-mcp}"];
        # type = "local";
        # environment = {
        # TAVILY_API_KEY = ''{env:TAVILY_API_KEY}'';
        # };
        # };
        # morph-fast-apply = {
        # command = ["${fast-apply-mcp}"];
        # type = "local";
        # environment = {
        # ALL_TOOLS = "false";
        # MORPH_API_KEY = ''{env:MORPH_API_KEY}'';
        # };
        # };
        kiri = {
          command = ["${kiri-mcp}" "--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
          type = "local";
        };
      };
    };
  in {
    home.file = {
      "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs mcphub-servers;
      "Library/Application Support/Claude/claude_desktop_config.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs claude-desktop-servers;
    };
    programs.claude-code.mcpServers = (inputs.mcp-servers-nix.lib.evalModule pkgs claude-code-servers).config.settings.servers;
    programs.codex.settings.mcp_servers = (inputs.mcp-servers-nix.lib.evalModule pkgs codex-servers).config.settings.servers;
    programs.crush.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs crush-servers).config.settings.servers;
    programs.opencode.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs opencode-servers).config.settings.servers;
  };
}
