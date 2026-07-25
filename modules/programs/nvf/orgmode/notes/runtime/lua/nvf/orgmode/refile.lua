local M = {}

local function canonical_path(path)
  return vim.fn.resolve(vim.fn.fnamemodify(vim.fn.expand(path), ":p"))
end

function M.setup(opts)
  opts = opts or {}

  local clear_todo_destinations = {}
  for _, path in ipairs(opts.clear_todo_destinations or {}) do
    clear_todo_destinations[canonical_path(path)] = true
  end

  local capture = require("orgmode").instance().capture

  -- This wraps orgmode.nvim's regular-file refile path. Recheck it when
  -- updating orgmode.nvim because _refile_from_org_file is private API.
  if capture._clear_todo_refile_rule_installed then
    return
  end
  capture._clear_todo_refile_rule_installed = true

  function capture:refile_headline_to_destination()
    local source_headline = self.files:get_closest_headline()

    return self:get_destination():next(function (destination)
      if not destination then
        return false
      end

      local destination_file = destination.file
      local should_clear_todo = clear_todo_destinations[canonical_path(destination_file.filename)]

      return self:_refile_from_org_file({
        source_headline = source_headline,
        destination_file = destination_file,
        destination_headline = destination.headline,
      }):next(function (target_line)
        if not should_clear_todo or not target_line then
          return target_line
        end

        return destination_file:update(function (file)
          local moved_headline = file:get_closest_headline({ target_line, 0 })
          moved_headline:set_todo("")
        end):next(function ()
          return target_line
        end)
      end)
    end)
  end
end

return M
