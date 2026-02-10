let Plugin = {
  repo | String,
  depends | Array String | optional,
  on_map | Dyn | optional,
  on_cmd | std.contract.any_of [String, Array String] | optional,
  on_event | Array String | optional,
  on_source | std.contract.any_of [String, Array String] | optional,
  hooks_file | String | optional,
  hook_add | String | optional,
  hook_source | String | optional,
  "if" | String | optional,
  lua_add | String | optional,
  lua_source | String | optional,
}
in {
  plugins | Array Plugin,
}
