let Plugin = {
  repo | String,
  depends | Array String | optional,
  on_map | Dyn | optional,
  on_cmd | String | optional,
  on_event | Array String | optional,
  on_source | String | optional,
  hooks_file | String | optional,
  lua_add | String | optional,
  lua_source | String | optional,
}
in {
  plugins | Array Plugin,
}
