local lz_n = require("lz.n")

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
