-- blink.cmp 1.10 has no cross-provider deduplication API yet.
-- Keep one item per label. Earlier source_priority entries win;
-- source ids absent from that list lose to every listed source.
local source_priority = vim.json.decode([=[@source_priority_json@]=])
local fuzzy = require("blink.cmp.fuzzy")
if not fuzzy._nvf_deduplicates_labels then
  local original_fuzzy = fuzzy.fuzzy
  local unknown_rank = #source_priority + 1
  local rank_by_source = {}

  for index, source_id in ipairs(source_priority) do
    rank_by_source[source_id] = index
  end

  fuzzy.fuzzy = function (...)
    local items = original_fuzzy(...)
    local winner_by_label = {}

    for index, item in ipairs(items) do
      local rank = rank_by_source[item.source_id] or unknown_rank
      local winner = winner_by_label[item.label]
      if not winner or rank < winner.rank then
        winner_by_label[item.label] = { index = index, rank = rank }
      end
    end

    local deduped = {}
    for index, item in ipairs(items) do
      local winner = winner_by_label[item.label]
      if winner and winner.index == index then
        deduped[#deduped + 1] = item
      end
    end

    return deduped
  end

  fuzzy._nvf_deduplicates_labels = true
end
