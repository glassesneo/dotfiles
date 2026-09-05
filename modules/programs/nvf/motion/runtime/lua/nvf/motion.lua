-- Stay-star: set @/ without moving the cursor so cinnamon.nvim
-- does not animate a jump-and-return. n/N keep cinnamon maps.
return function()
  local word = vim.fn.expand("<cword>")
  if word == "" then
    return
  end
  local pattern = [[\<]] .. vim.fn.escape(word, [[\]]) .. [[\>]]
  vim.fn.setreg("/", pattern)
  vim.fn.histadd("search", pattern)
  vim.v.searchforward = 1
  vim.v.hlsearch = 1
end
