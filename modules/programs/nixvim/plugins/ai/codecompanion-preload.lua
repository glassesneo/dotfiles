local lz_n = require("lz.n")
lz_n.trigger_load("codecompanion-history.nvim")

lz_n.trigger_load("fzf-lua")

local skipped = lz_n.trigger_load("blink.cmp")
if #skipped == 0 then
  local blink = require("blink.cmp")
  blink.add_source_provider("codecompanion", {
    name = "CodeCompanion",
    module = "codecompanion.providers.completion.blink",
    enabled = true,
  })
end

lz_n.trigger_load("mcphub")

require("mcphub").setup({
  auto_approve = function(params)
    local allowed_servers = {
      context7 = true,
      ["brave-search"] = true,
      deepwiki = true,
      ["sequential-thinking"] = true,
      readability = true,
      tavily = true,
      time = true,
    }
    if allowed_servers[params.server_name] then
      return true
    end

    local allowed_filesystem_tools = {
      directory_tree = true,
      get_file_info = true,
      list_allowed_directories = true,
      list_directory = true,
      read_file = true,
      read_multiple_files = true,
      search_files = true,
    }

    if params.server_name == "filesystem" and allowed_filesystem_tools[params.tool_name] then
      return true
    end

    local allowed_neovim_tools = {
      list_directory = true,
      read_file = true,
    }

    if params.server_name == "neovim" and allowed_neovim_tools[params.tool_name] then
      return true
    end

    local allowed_memory_tools = {
      read_graph = true,
    }

    if params.server_name == "memory" and allowed_memory_tools[params.tool_name] then
      return true
    end

    if params.server_name == "mcphub" and params.tool_name == "get_current_servers" then
      return true
    end

    return false
  end,
  cmd = "@mcp-hub-exe@",
})
