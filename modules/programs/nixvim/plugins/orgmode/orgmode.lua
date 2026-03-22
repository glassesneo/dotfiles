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
