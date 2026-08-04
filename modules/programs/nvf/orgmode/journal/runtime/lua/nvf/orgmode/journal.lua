local M = {}

local function shifted_date(days)
  local date = os.date('*t')
  date.day = date.day + days
  date.hour = 12
  date.min = 0
  date.sec = 0

  return os.time(date)
end

function M.previous_week_heading()
  return os.date('%G-W%V', shifted_date(-7))
end

function M.tomorrow_timestamp()
  return os.date('<%Y-%m-%d %A>', shifted_date(1))
end

return M
