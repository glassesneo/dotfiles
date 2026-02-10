local function zettel_capture(kind)
  local orgfiles = vim.fn.expand("~/orgfiles")
  local map = {
    literature = { dir = "zettelkasten/literature", tag = "literature", needs_source = true },
    permanent = { dir = "zettelkasten/knowledge", tag = "permanent", needs_source = false },
    structure = { dir = "zettelkasten/knowledge", tag = "structure", needs_source = false },
  }
  local spec = map[kind]
  if not spec then
    vim.notify("Unknown zettel kind: " .. tostring(kind), vim.log.levels.ERROR)
    return
  end

  vim.ui.input({ prompt = "Title: " }, function(title)
    if not title or title == "" then
      return
    end

    local function with_source(source)
      if spec.needs_source and (not source or source == "") then
        return
      end

      local ts = os.date("%Y%m%d-%H%M%S")
      local dir = orgfiles .. "/" .. spec.dir
      vim.fn.mkdir(dir, "p")

      local suffix = 0
      local filename = ts .. ".org"
      local path = dir .. "/" .. filename
      while vim.fn.filereadable(path) == 1 do
        suffix = suffix + 1
        filename = string.format("%s-%02d.org", ts, suffix)
        path = dir .. "/" .. filename
      end

      local lines = {
        "#+TITLE: " .. ts .. " " .. title,
        "#+FILETAGS: :" .. spec.tag .. ":",
      }
      if spec.needs_source then
        table.insert(lines, 2, "#+SOURCE: " .. source)
      end
      table.insert(lines, "")
      table.insert(lines, "* " .. title)
      table.insert(lines, "")

      vim.fn.writefile(lines, path)
      vim.cmd("edit " .. vim.fn.fnameescape(path))
      vim.api.nvim_win_set_cursor(0, { #lines, 0 })
      vim.cmd("startinsert")
    end

    if spec.needs_source then
      vim.ui.input({ prompt = "Source: " }, with_source)
    else
      with_source("")
    end
  end)
end

vim.api.nvim_create_user_command("Zettel", function(opts)
  zettel_capture(opts.args)
end, {
  nargs = 1,
  complete = function()
    return { "literature", "permanent", "structure" }
  end,
})

-- :Today command — daily journal with Top3 carryover from yesterday

--- Extract Top3 task text from a daily file (journal/daily/YYYY-MM-DD.org).
--- Looks for `* Today's Plan` heading and collects up to 3 checkbox items.
--- Returns list of text strings (without checkbox prefix).
local function extract_top3_from_daily(content)
  local items = {}
  local in_plan = false
  for _, line in ipairs(content) do
    if in_plan then
      if line:match("^%*") then
        break
      end
      local text = line:match("^%s*%- %[[ Xx%-]%] (.+)$")
      if text then
        items[#items + 1] = text
        if #items >= 3 then
          break
        end
      elseif line:match("^%s*$") then
        -- skip blank lines
      else
        break
      end
    elseif line:match("^%*+ Today's Plan") then
      in_plan = true
    end
  end
  return items
end

--- Extract Top3 task text from a monthly datetree file (journal/YYYY-MM.org),
--- scoped to yesterday's subtree only. Uses the last occurrence of `明日のTop3`
--- within the subtree (tie-breaker for multiple diary entries).
--- @param content string[] file lines
--- @param yesterday_date string "YYYY-MM-DD" format
--- Returns list of text strings (without checkbox prefix).
local function extract_top3_from_monthly(content, yesterday_date)
  local date_pattern = yesterday_date:gsub("%-", "%%-")

  -- Step 1: Find yesterday heading and remember its level (supports *** or ****, etc.)
  local day_heading_line = nil
  local day_level = nil
  for i, line in ipairs(content) do
    local stars = line:match("^(%*+)%s+" .. date_pattern .. "%s")
      or line:match("^(%*+)%s+" .. date_pattern .. "$")
    if stars then
      day_heading_line = i
      day_level = #stars
      break
    end
  end
  if not day_heading_line then
    return {}
  end

  -- Step 2: Scope to yesterday subtree only: until next same-or-higher heading
  local subtree_start = day_heading_line + 1
  local subtree_end = #content
  for i = subtree_start, #content do
    local stars = content[i]:match("^(%*+)%s")
    if stars and #stars <= day_level then
      subtree_end = i - 1
      break
    end
  end

  -- Step 3: Find last 明日のTop3 section label in subtree (tie-breaker)
  local last_top3_line = nil
  for i = subtree_start, subtree_end do
    if content[i]:match("^%s*%- %s*明日のTop3%s*::") then
      last_top3_line = i
    end
  end
  if not last_top3_line then
    return {}
  end

  -- Step 4: Collect up to 3 checkbox items after that label
  local items = {}
  for i = last_top3_line + 1, subtree_end do
    local line = content[i]
    local text = line:match("^%s*%- %[[ Xx%-]%]%s+(.+)$")
    if text then
      items[#items + 1] = text
      if #items >= 3 then
        break
      end
    elseif line:match("^%s*$") then
      -- skip blank lines
    elseif line:match("^%s*%- .+ ::%s*$") then
      -- next diary section label
      break
    else
      -- malformed/unexpected line -> stop safely
      break
    end
  end

  return items
end

--- Main :Today command — create/open today's daily journal with Top3 carryover.
local function today_command()
  local ok_expand, orgfiles = pcall(vim.fn.expand, "~/orgfiles")
  if not ok_expand then
    vim.notify("Today: failed to expand orgfiles path: " .. tostring(orgfiles), vim.log.levels.ERROR)
    return
  end

  local today_date = os.date("%Y-%m-%d")
  local yesterday_time = os.time() - 86400
  local yesterday_date = os.date("%Y-%m-%d", yesterday_time)

  local daily_yesterday = orgfiles .. "/journal/daily/" .. yesterday_date .. ".org"
  local monthly_yesterday = orgfiles .. "/journal/" .. os.date("%Y-%m", yesterday_time) .. ".org"
  local today_path = orgfiles .. "/journal/daily/" .. today_date .. ".org"

  -- If today's file already exists, just open it without modification
  if vim.fn.filereadable(today_path) == 1 then
    vim.cmd.edit(vim.fn.fnameescape(today_path))
    return
  end

  -- Extract Top3 from yesterday (precedence: monthly diary first, daily file fallback)
  local top3 = {}

  -- Try monthly diary file first (primary source - contains user's explicit 明日のTop3)
  if vim.fn.filereadable(monthly_yesterday) == 1 then
    local ok_read, monthly_content = pcall(vim.fn.readfile, monthly_yesterday)
    if ok_read and monthly_content then
      top3 = extract_top3_from_monthly(monthly_content, yesterday_date)
    else
      vim.notify(
        "Today: failed to read " .. monthly_yesterday .. ": " .. tostring(monthly_content),
        vim.log.levels.WARN
      )
    end
  end

  -- Fallback to daily file if no Top3 from diary
  if #top3 == 0 and vim.fn.filereadable(daily_yesterday) == 1 then
    local ok_read, daily_content = pcall(vim.fn.readfile, daily_yesterday)
    if ok_read and daily_content then
      top3 = extract_top3_from_daily(daily_content)
    else
      vim.notify("Today: failed to read " .. daily_yesterday .. ": " .. tostring(daily_content), vim.log.levels.WARN)
    end
  end

  -- Build template lines
  local template_lines = {
    "* Today's Plan",
    "",
  }

  if #top3 > 0 then
    for _, text in ipairs(top3) do
      template_lines[#template_lines + 1] = "- [ ] " .. text
    end
  else
    template_lines[#template_lines + 1] = "- [ ] "
    template_lines[#template_lines + 1] = "- [ ] "
    template_lines[#template_lines + 1] = "- [ ] "
  end

  template_lines[#template_lines + 1] = ""
  template_lines[#template_lines + 1] = "* Notes"
  template_lines[#template_lines + 1] = ""

  -- Create directory
  local ok_mkdir, mkdir_err = pcall(vim.fn.mkdir, orgfiles .. "/journal/daily", "p")
  if not ok_mkdir then
    vim.notify("Today: failed to create directory: " .. tostring(mkdir_err), vim.log.levels.WARN)
  end

  -- Write file
  local ok_write, write_err = pcall(vim.fn.writefile, template_lines, today_path)
  if not ok_write then
    vim.notify("Today: failed to write " .. today_path .. ": " .. tostring(write_err), vim.log.levels.ERROR)
    return
  end

  -- Open file
  vim.cmd.edit(vim.fn.fnameescape(today_path))

  -- Safe cursor placement (newly created file only)
  -- Target line 3 (first checkbox, 1-indexed), column 6 (after "- [ ] ")
  local line_count = vim.api.nvim_buf_line_count(0)
  if line_count >= 3 then
    vim.api.nvim_win_set_cursor(0, { 3, 6 })
  end
end

vim.api.nvim_create_user_command("Today", function()
  today_command()
end, {
  nargs = 0,
  desc = "Open today's daily journal with Top3 from yesterday",
})
