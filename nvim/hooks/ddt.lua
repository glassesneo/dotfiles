--- lua_source {{{
local artemis = require("artemis")
vim.keymap.set("n", "<Leader>d", function() end)
artemis.g.denops.server.deno_args = {
  "-q",
  "-A",
  "--unstable-ffi",
}
artemis.fn.ddt.custom.load_config(vim.env.HOOK_DIR .. "/ddt.ts")
--- }}
