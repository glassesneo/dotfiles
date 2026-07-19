vim.filetype.add({
  extension = {
    ino = "arduino",
    pde = "arduino",
    ncl = "nickel",
    prisma = "prisma",
    mbt = "moonbit",
    mbti = "moonbit",
    mbi = "moonbit",
  },
})

pcall(vim.treesitter.language.register, "cpp", "arduino")

vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = { "*.mbt", "*.mbti", "*.mbi" },
  callback = function ()
    vim.bo.filetype = "moonbit"
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "moonbit" },
  callback = function (args)
    pcall(vim.treesitter.start, args.buf)
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "arduino" },
  callback = function (args)
    vim.bo[args.buf].syntax = "cpp"
    pcall(vim.treesitter.start, args.buf, "cpp")
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "python", "zig" },
  callback = function ()
    vim.bo.expandtab = true
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "go" },
  callback = function ()
    vim.bo.expandtab = false
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
  end,
})
