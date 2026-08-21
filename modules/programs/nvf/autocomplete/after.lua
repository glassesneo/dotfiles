-- blink.cmp 1.10 has no cross-provider deduplication API yet.
-- Remove plain-text candidates when a structured source has the same label.
local fuzzy = require("blink.cmp.fuzzy")
if not fuzzy._nvf_deduplicates_text_sources then
  local original_fuzzy = fuzzy.fuzzy

  fuzzy.fuzzy = function (...)
    local items = original_fuzzy(...)
    local preferred_labels = {}

    for _, item in ipairs(items) do
      if item.source_id == "lsp" or item.source_id == "snippets" then
        preferred_labels[item.label] = true
      end
    end

    return vim.tbl_filter(function (item)
      local is_plain_text_source = item.source_id == "buffer" or item.source_id == "ripgrep"
      return not (is_plain_text_source and preferred_labels[item.label])
    end, items)
  end

  fuzzy._nvf_deduplicates_text_sources = true
end
