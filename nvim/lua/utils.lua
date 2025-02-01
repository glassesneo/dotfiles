local utils = {}

---@param mode string|string[]
---@param lhs string
---@param opts? table
function utils.unmap(mode, lhs, opts)
  vim.keymap.del(mode, lhs, opts or {})
end

---@generic T
---@param a T[]
---@param b T[]
---@return T[]
---@nodiscard
function utils.array_concat(a, b)
  local result = {}
  for i = 1, #a do
    table.insert(result, a[i])
  end
  for i = 1, #b do
    table.insert(result, b[i])
  end
  return result
end

---@generic T
---@param a T[]
---@param b T[]
---@return T[]
---@nodiscard
function utils.array_concat_unique(a, b)
  local result = {}
  local seen = {}
  for _, v in ipairs(a) do
    if not seen[v] then
      table.insert(result, v)
      seen[v] = true
    end
  end
  for _, v in ipairs(b) do
    if not seen[v] then
      table.insert(result, v)
      seen[v] = true
    end
  end
  return result
end

---@generic T
---@param a table
---@param b table
---@return table
---@nodiscard
function utils.table_merge(a, b)
  local result = {}
  for k, v in pairs(a) do
    result[k] = v
  end
  for k, v in pairs(b) do
    result[k] = v
  end
  return result
end

return utils
