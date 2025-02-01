--- lua_source {{{
local artemis = require("artemis")
-- Nim
artemis.fn.lexima.add_rule({
  char = ".",
  at = [[{\%#}]],
  input_after = ".",
  filetype = { "nim", "nims", "nimble" },
})
artemis.fn.lexima.add_rule({
  char = ".",
  at = [[{\%#.}]],
  leave = 1,
  filetype = { "nim", "nims", "nimble" },
})
artemis.fn.lexima.add_rule({
  char = "<BS>",
  at = [[{.\%#.}]],
  delete = 1,
  filetype = { "nim", "nims", "nimble" },
})

--- }}}
