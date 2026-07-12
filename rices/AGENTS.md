# rices/

## Local Contract

- Rices select desktop-experience policy only through repository-owned typed interfaces. Feature and toplevel modules own package resolution, upstream options, imports, runtime wiring, and platform behavior.
- Do not use `pkgs` in `delib.rice`; it does not represent the selected host platform. Select symbolic or typed values and let the owning module resolve packages.
- Select colors from `myconfig.colorschemes` and wallpapers by symbolic `myconfig.wallpaper.title`; do not define palettes or concrete wallpaper paths here.
- Keep Nixvim plugin settings, Lua, and autocmds in the Nixvim owner rather than rice policy.
