-- :Today command — create/open today's single-file journal

--- Find the range of the first heading matching the given title.
---@param content string[]
---@param title   string
---@return integer|nil, integer|nil
local function find_heading_range(content, title)
  local start_line = nil
  local level = nil

  for i, line in ipairs(content) do
    local stars, heading = line:match("^(%*+)%s+(.-)%s*$")
    if stars and heading == title then
      start_line = i
      level = #stars
      break
    end
  end

  if not start_line or not level then
    return nil, nil
  end

  local end_line = #content
  for i = start_line + 1, #content do
    local stars = content[i]:match("^(%*+)%s+")
    if stars and #stars <= level then
      end_line = i - 1
      break
    end
  end

  return start_line, end_line
end

--- Extract up to 3 unfinished checkbox items from the `Plan` section.
---@param content string[]
---@return string[]
local function extract_top3_from_plan(content)
  local plan_start, plan_end = find_heading_range(content, "Plan")
  if not plan_start or not plan_end then
    return {}
  end

  local items = {}
  for i = plan_start + 1, plan_end do
    local line = content[i]
    local text = line:match("^%s*%- %[ %] (.+)$")
    if text then
      items[#items + 1] = text
      if #items >= 3 then
        break
      end
    end
  end

  return items
end

--- Extract up to 3 unfinished checkbox items from `明日のTop3` in the `Diary` section.
---@param content string[]
---@return string[]
local function extract_top3_from_diary(content)
  local diary_start, diary_end = find_heading_range(content, "Diary")
  if not diary_start or not diary_end then
    return {}
  end

  local top3_line = nil
  for i = diary_start + 1, diary_end do
    if content[i]:match("^%s*%- %s*明日のTop3%s*::") then
      top3_line = i
      break
    end
  end

  if not top3_line then
    return {}
  end

  local items = {}
  for i = top3_line + 1, diary_end do
    local line = content[i]
    local text = line:match("^%s*%- %[ %]%s+(.+)$")
    if text then
      items[#items + 1] = text
      if #items >= 3 then
        break
      end
    elseif line:match("^%s*%- %[[Xx%-]%]") or line:match("^%s*$") then
      -- Skip completed items and empty lines.
    elseif line:match("^%s*%- .+ ::%s*$") or line:match("^%*") then
      break
    else
      break
    end
  end

  return items
end

--- Build the daily journal scaffold.
---@param checkin_time string
---@param top3         string[]
---@return string[]
local function build_daily_template(checkin_time, top3)
  local lines = {
    "* Journal", "** Checkin", ":PROPERTIES:", ":FEELING:", ":MOOD:", ":ENERGY:", ":END:", "  [" .. checkin_time .. "]",
    "", "** Plan",
  }

  if #top3 > 0 then
    for _, text in ipairs(top3) do
      lines[#lines + 1] = "- [ ] " .. text
    end
  else
    lines[#lines + 1] = "- [ ] "
    lines[#lines + 1] = "- [ ] "
    lines[#lines + 1] = "- [ ] "
  end

  lines[#lines + 1] = ""
  lines[#lines + 1] = "** Notes"
  lines[#lines + 1] = ""
  lines[#lines + 1] = ""
  lines[#lines + 1] = "** Diary"
  lines[#lines + 1] = "- 一行 :: "
  lines[#lines + 1] = "- できた ::"
  lines[#lines + 1] = "  - "
  lines[#lines + 1] = "- ひっかかり ::"
  lines[#lines + 1] = "  - "
  lines[#lines + 1] = "- 明日のTop3 ::"
  lines[#lines + 1] = "  - [ ] "
  lines[#lines + 1] = "  - [ ] "
  lines[#lines + 1] = "  - [ ] "

  return lines
end

local function today_command()
  local journal = "@journal-path@"
  local today_date = os.date("%Y-%m-%d")
  local yesterday_time = os.time() - 86400
  local yesterday_date = os.date("%Y-%m-%d", yesterday_time)
  local today_time = os.date("%H:%M")

  local today_path = journal .. "/" .. today_date .. ".org"
  local yesterday_path = journal .. "/" .. yesterday_date .. ".org"

  if vim.fn.filereadable(today_path) == 1 then
    vim.cmd.edit(vim.fn.fnameescape(today_path))
    return
  end

  local top3 = {}
  if vim.fn.filereadable(yesterday_path) == 1 then
    local ok_read, yesterday_content = pcall(vim.fn.readfile, yesterday_path)
    if ok_read and yesterday_content then
      top3 = extract_top3_from_diary(yesterday_content)
      if #top3 == 0 then
        top3 = extract_top3_from_plan(yesterday_content)
      end
    else
      vim.notify("Today: failed to read " .. yesterday_path .. ": " .. tostring(yesterday_content), vim.log.levels.WARN)
    end
  end

  local ok_mkdir, mkdir_err = pcall(vim.fn.mkdir, journal, "p")
  if not ok_mkdir then
    vim.notify("Today: failed to create directory: " .. tostring(mkdir_err), vim.log.levels.WARN)
  end

  local template_lines = build_daily_template(today_time, top3)
  local ok_write, write_err = pcall(vim.fn.writefile, template_lines, today_path)
  if not ok_write then
    vim.notify("Today: failed to write " .. today_path .. ": " .. tostring(write_err), vim.log.levels.ERROR)
    return
  end

  vim.cmd.edit(vim.fn.fnameescape(today_path))

  if vim.api.nvim_buf_line_count(0) >= 4 then
    vim.api.nvim_win_set_cursor(0, { 4, 10 })
  end
end

vim.api.nvim_create_user_command(
  "Today",
  function ()
    today_command()
  end,
  {
    nargs = 0,
    desc = "Open today's journal and create it with checkin scaffold if missing",
  }
)
