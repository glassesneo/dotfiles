function()
  if vim.bo.filetype == "org" then
    require('orgmode').action('org_mappings.open_at_point')
    return
  end
  vim.cmd("normal! gf")
end
