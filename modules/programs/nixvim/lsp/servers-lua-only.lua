-- Lua-owned servers without nixvim schema support or with Lua-only APIs.
local lua_only_executables = {
	["arduino_language_server"] = "arduino-language-server",
	["emmylua_ls"] = "emmylua_ls",
	["sourcekit"] = "sourcekit-lsp",
	["denols"] = "deno",
	["ts_ls"] = "typescript-language-server",
	["moonbit-lsp"] = "moonbit-lsp",
}

-- Arduino LSP stays Lua-owned because startup depends on project-local
-- `sketch.yaml` metadata and per-workspace command construction.
local uv = vim.uv
local arduino_warning_keys = {}
local arduino_project_cache = {}
local arduino_startup_state = {}
local arduino_client_roots = {}
local arduino_data_dir_candidates = {
	vim.fs.normalize(vim.fn.expand("~/Library/Arduino15")),
	vim.fs.normalize(vim.fn.expand("~/.arduino15")),
}
local arduino_cli_config_candidates = {
	vim.fs.normalize(vim.fn.expand("~/Library/Arduino15/arduino-cli.yaml")),
	vim.fs.normalize(vim.fn.expand("~/.arduino15/arduino-cli.yaml")),
}

local function normalize_path(path)
	if not path or path == "" then
		return nil
	end
	return vim.fs.normalize(path)
end

local function realpath_or_self(path)
	local normalized = normalize_path(path)
	if not normalized then
		return nil
	end
	local resolved = uv.fs_realpath(normalized)
	if resolved and resolved ~= "" then
		return resolved
	end
	return normalized
end

local function file_exists(path)
	local stat = uv.fs_stat(path)
	return stat ~= nil and stat.type == "file"
end

local function dir_exists(path)
	local stat = uv.fs_stat(path)
	return stat ~= nil and stat.type == "directory"
end

local function notify_arduino(message, level, opts)
	opts = opts or {}
	local notify_opts = {
		title = "Arduino LSP",
	}
	if opts.id then
		notify_opts.replace = opts.id
	end
	if opts.timeout ~= nil then
		notify_opts.timeout = opts.timeout
	end
	return vim.notify(message, level or vim.log.levels.INFO, notify_opts)
end

local function notify_arduino_once(key, message, level)
	if arduino_warning_keys[key] then
		return
	end
	arduino_warning_keys[key] = true
	notify_arduino(message, level or vim.log.levels.WARN)
end

local function strip_yaml_scalar(value)
	if not value then
		return nil
	end
	local stripped = vim.trim(value:gsub("%s+#.*$", ""))
	if stripped:match('^".*"$') or stripped:match("^'.*'$") then
		stripped = stripped:sub(2, -2)
	end
	if stripped == "" then
		return nil
	end
	return stripped
end

local function read_yaml_scalar(path, key)
	local lines = vim.fn.readfile(path)
	if vim.v.shell_error ~= 0 then
		return nil
	end

	for _, line in ipairs(lines) do
		local value = line:match("^" .. vim.pesc(key) .. ":%s*(.-)%s*$")
		if value then
			return strip_yaml_scalar(value)
		end
	end

	return nil
end

local function join_progress_detail(parts)
	local chunks = {}
	for _, part in ipairs(parts) do
		if part and part ~= "" then
			table.insert(chunks, part)
		end
	end
	if #chunks == 0 then
		return nil
	end
	return table.concat(chunks, ": ")
end

local function format_elapsed(started_at)
	local elapsed_ms = (uv.hrtime() - started_at) / 1e6
	if elapsed_ms < 1000 then
		return string.format("%dms", math.floor(elapsed_ms + 0.5))
	end
	return string.format("%.1fs", elapsed_ms / 1000)
end

-- Arduino startup is dominated by compile database generation and clangd warmup.
-- Keep the delay visible per sketch root instead of adding activation hacks.
local function begin_arduino_startup(project)
	local state = arduino_startup_state[project.root_dir] or {}
	if state.pending then
		return state
	end

	state.pending = true
	state.ready = false
	state.started_at = uv.hrtime()
	state.notify_id = notify_arduino(
		("Preparing compile database for %s (%s)..."):format(vim.fs.basename(project.root_dir), project.default_fqbn),
		vim.log.levels.INFO,
		{ id = state.notify_id, timeout = false }
	)
	arduino_startup_state[project.root_dir] = state
	return state
end

local function finish_arduino_startup(root_dir, detail)
	local state = arduino_startup_state[root_dir]
	if not state or state.ready or not state.started_at then
		return
	end

	state.pending = false
	state.ready = true
	local message = ("Ready for %s in %s."):format(vim.fs.basename(root_dir), format_elapsed(state.started_at))
	if detail and detail ~= "" then
		message = message .. " " .. detail
	end
	state.notify_id = notify_arduino(message, vim.log.levels.INFO, { id = state.notify_id, timeout = 3000 })
end

local function note_arduino_startup_attached(root_dir)
	local state = arduino_startup_state[root_dir]
	if not state or state.ready or not state.started_at then
		return
	end

	state.notify_id = notify_arduino(
		("Connected for %s in %s. Waiting for clangd..."):format(
			vim.fs.basename(root_dir),
			format_elapsed(state.started_at)
		),
		vim.log.levels.INFO,
		{ id = state.notify_id, timeout = false }
	)
end

local function finish_arduino_startup_from_progress(root_dir, value)
	local detail = join_progress_detail({
		value and value.title,
		value and value.message,
		"clangd is indexing in the background.",
	})
	finish_arduino_startup(root_dir, detail)
end

local function fail_arduino_startup(root_dir, code, signal)
	local state = arduino_startup_state[root_dir]
	if not state or state.ready or not state.started_at then
		return
	end
	state.pending = false
	if code == 0 and signal == 0 then
		return
	end

	state.notify_id = notify_arduino(
		("Startup failed for %s after %s (exit %d, signal %d). See :LspLog."):format(
			vim.fs.basename(root_dir),
			format_elapsed(state.started_at),
			code,
			signal
		),
		vim.log.levels.WARN,
		{ id = state.notify_id, timeout = 5000 }
	)
end

local function has_primary_sketch_file(sketch_root)
	local sketch_name = vim.fs.basename(sketch_root)
	if not sketch_name or sketch_name == "" then
		return false
	end

	local ino_path = sketch_root .. "/" .. sketch_name .. ".ino"
	if file_exists(ino_path) then
		return true
	end

	local pde_path = sketch_root .. "/" .. sketch_name .. ".pde"
	return file_exists(pde_path)
end

local function read_arduino_cli_data_dir(cli_config)
	local lines = vim.fn.readfile(cli_config)
	if vim.v.shell_error ~= 0 then
		for _, candidate in ipairs(arduino_data_dir_candidates) do
			if dir_exists(candidate) then
				return candidate
			end
		end
		return arduino_data_dir_candidates[1]
	end

	local in_directories = false
	for _, line in ipairs(lines) do
		if line:match("^directories:%s*$") then
			in_directories = true
		elseif in_directories and line:match("^[^%s]") then
			in_directories = false
		elseif in_directories then
			local value = strip_yaml_scalar(line:match("^%s+data:%s*(.-)%s*$"))
			if value then
				return vim.fs.normalize(vim.fn.expand(value))
			end
		end
	end

	for _, candidate in ipairs(arduino_data_dir_candidates) do
		if dir_exists(candidate) then
			return candidate
		end
	end

	return arduino_data_dir_candidates[1]
end

local function parse_fqbn(default_fqbn)
	local vendor, architecture, board = default_fqbn:match("^([^:]+):([^:]+):([^:]+)")
	if not vendor or not architecture or not board then
		return nil
	end
	return {
		vendor = vendor,
		architecture = architecture,
		board = board,
	}
end

local function has_installed_core(cli_config, default_fqbn)
	local fqbn = parse_fqbn(default_fqbn)
	if not fqbn then
		return false
	end

	local data_dir = read_arduino_cli_data_dir(cli_config)
	local platform_root = table.concat({
		data_dir,
		"packages",
		fqbn.vendor,
		"hardware",
		fqbn.architecture,
	}, "/")

	if not dir_exists(platform_root) then
		return false
	end

	local handle = uv.fs_scandir(platform_root)
	if not handle then
		return false
	end

	while true do
		local name, entry_type = uv.fs_scandir_next(handle)
		if not name then
			break
		end
		if entry_type == "directory" then
			return true
		end
	end

	return false
end

local function arduino_preflight_error(key, message, level)
	return {
		key = key,
		message = message,
		level = level or vim.log.levels.WARN,
	}
end

local function resolve_arduino_cli_config(default_fqbn)
	local fallback = nil
	for _, cli_config in ipairs(arduino_cli_config_candidates) do
		if file_exists(cli_config) then
			fallback = fallback or cli_config
			if not default_fqbn or has_installed_core(cli_config, default_fqbn) then
				return cli_config
			end
		end
	end
	return fallback
end

local function resolve_executable(name)
	local resolved = vim.fn.exepath(name)
	if resolved == nil or resolved == "" then
		return nil
	end
	return resolved
end

local function find_sketch_root(start_path)
	local current = realpath_or_self(start_path)
	if not current then
		return nil
	end
	if not dir_exists(current) then
		current = vim.fs.dirname(current)
	end
	if not current or current == "" then
		return nil
	end

	while current do
		local sketch_yaml = current .. "/sketch.yaml"
		if file_exists(sketch_yaml) then
			return current, sketch_yaml
		end

		if dir_exists(current .. "/.git") then
			return nil
		end

		local parent = vim.fs.dirname(current)
		if not parent or parent == current then
			return nil
		end
		current = parent
	end

	return nil
end

local function resolve_arduino_project(start_path)
	local sketch_root, sketch_yaml = find_sketch_root(start_path)
	if not sketch_root or not sketch_yaml then
		return nil,
			arduino_preflight_error(
				("missing-sketch:%s"):format(start_path),
				"Arduino LSP: no ancestor sketch.yaml found before the project boundary.",
				vim.log.levels.INFO
			)
	end

	local default_fqbn = read_yaml_scalar(sketch_yaml, "default_fqbn")
	if not default_fqbn then
		return nil,
			arduino_preflight_error(
				("missing-fqbn:%s"):format(sketch_yaml),
				("Arduino LSP: %s is missing default_fqbn. Run `arduino-cli board attach -b <fqbn> -p <port>` in this sketch."):format(
					sketch_yaml
				)
			)
	end

	if not has_primary_sketch_file(sketch_root) then
		local sketch_name = vim.fs.basename(sketch_root)
		return nil,
			arduino_preflight_error(
				("missing-primary-sketch:%s"):format(sketch_root),
				("Arduino LSP: %s must contain %s.ino or %s.pde to compile a sketch-local database."):format(
					sketch_root,
					sketch_name,
					sketch_name
				)
			)
	end

	local arduino_cli_config = resolve_arduino_cli_config(default_fqbn)
	if not arduino_cli_config then
		return nil,
			arduino_preflight_error(
				"missing-cli-config",
				("Arduino LSP: missing Arduino CLI config. Create %s or %s before starting the server."):format(
					arduino_cli_config_candidates[1],
					arduino_cli_config_candidates[2]
				)
			)
	end

	local arduino_language_server = resolve_executable("arduino-language-server")
	local clangd = resolve_executable("clangd")
	local arduino_cli = resolve_executable("arduino-cli")
	if not arduino_language_server or not clangd or not arduino_cli then
		local missing_executables = {}
		if not arduino_language_server then
			table.insert(missing_executables, "arduino-language-server")
		end
		if not clangd then
			table.insert(missing_executables, "clangd")
		end
		if not arduino_cli then
			table.insert(missing_executables, "arduino-cli")
		end
		return nil,
			arduino_preflight_error(
				("missing-executables:%s"):format(table.concat(missing_executables, ",")),
				("Arduino LSP: missing required executables on PATH: %s."):format(
					table.concat(missing_executables, ", ")
				)
			)
	end

	if not has_installed_core(arduino_cli_config, default_fqbn) then
		local fqbn = parse_fqbn(default_fqbn)
		local core_hint = default_fqbn
		if fqbn then
			core_hint = fqbn.vendor .. ":" .. fqbn.architecture
		end
		return nil,
			arduino_preflight_error(
				("missing-core:%s"):format(default_fqbn),
				("Arduino LSP: missing installed core for %s under %s. Run `arduino-cli core install %s` before starting the server."):format(
					default_fqbn,
					read_arduino_cli_data_dir(arduino_cli_config),
					core_hint
				)
			)
	end

	local project = {
		root_dir = sketch_root,
		sketch_yaml = sketch_yaml,
		default_fqbn = default_fqbn,
		arduino_cli_config = arduino_cli_config,
		arduino_data_dir = read_arduino_cli_data_dir(arduino_cli_config),
		arduino_language_server = arduino_language_server,
		clangd = clangd,
		arduino_cli = arduino_cli,
		cmd = {
			arduino_language_server,
			"-clangd",
			clangd,
			"-cli",
			arduino_cli,
			"-cli-config",
			arduino_cli_config,
			"-fqbn",
			default_fqbn,
		},
	}

	arduino_project_cache[project.root_dir] = project
	return project
end

local function resolve_arduino_project_for_buffer(bufnr)
	local buf_path = realpath_or_self(vim.api.nvim_buf_get_name(bufnr))
	if not buf_path then
		notify_arduino_once(
			("arduino:missing-buffer:%s"):format(bufnr),
			"Arduino LSP: save the sketch to disk before starting the language server.",
			vim.log.levels.INFO
		)
		return nil
	end

	local project, err = resolve_arduino_project(buf_path)
	if err then
		notify_arduino_once(("arduino:%s"):format(err.key), err.message, err.level)
		return nil
	end
	return project
end

local library_paths = {
	vim.env.VIMRUNTIME .. "/lua",
	vim.env.VIMRUNTIME .. "/lua/vim/_meta",
	vim.fn.stdpath("config") .. "/lua",
}

local unique_library_paths = {}
local seen_paths = {}
for _, path in ipairs(library_paths) do
	if path and not seen_paths[path] then
		table.insert(unique_library_paths, path)
		seen_paths[path] = true
	end
end

vim.lsp.config.emmylua_ls = {
	settings = {
		Lua = {
			runtime = {
				version = "LuaJIT",
				pathStrict = true,
			},
			workspace = {
				library = unique_library_paths,
				checkThirdParty = false,
				ignoreDir = {
					".*",
				},
			},
			telemetry = { enable = false },
			hint = {
				enable = true,
				arrayIndex = "Enable",
				setType = true,
			},
		},
	},
	workspace_required = false,
}

vim.lsp.config.sourcekit = {
	single_file_support = true,
}

vim.lsp.config.denols = {
	single_file_support = true,
	init_options = {
		lint = true,
		unstable = true,
		suggest = {
			imports = {
				hosts = {
					["https://deno.land"] = true,
					["https://cdn.nest.land"] = true,
					["https://crux.land"] = true,
				},
			},
		},
	},
	settings = {
		rootMarkers = { "deno.json", "deno.jsonc" },
		deno = {
			inlayHints = {
				parameterNames = {
					enabled = "all",
					suppressWhenArgumentMatchesName = true,
				},
				parameterTypes = {
					enabled = true,
				},
				variableTypes = {
					enabled = true,
					suppressWhenTypeMatchesName = true,
				},
				propertyDeclarationTypes = {
					enabled = true,
				},
				functionLikeReturnTypes = {
					enabled = true,
				},
				enumMemberValues = {
					enabled = true,
				},
			},
		},
	},
}

vim.lsp.config.arduino_language_server = {
	filetypes = { "arduino" },
	root_dir = function(bufnr, on_dir)
		local project = resolve_arduino_project_for_buffer(bufnr)
		if project then
			on_dir(project.root_dir)
		end
	end,
	cmd = function(dispatchers, config)
		local project = arduino_project_cache[config.root_dir]
		if not project then
			local resolved_project, err = resolve_arduino_project(config.root_dir)
			if not resolved_project then
				error(err and err.message or "Arduino LSP: failed to resolve project metadata.")
			end
			project = resolved_project
		end
		begin_arduino_startup(project)
		arduino_project_cache[config.root_dir] = project
		return vim.lsp.rpc.start(project.cmd, dispatchers, {
			cwd = project.root_dir,
			env = config.cmd_env,
			detached = config.detached,
		})
	end,
	on_attach = function(client, _bufnr)
		if client.root_dir then
			arduino_client_roots[client.id] = client.root_dir
			note_arduino_startup_attached(client.root_dir)
		end
	end,
	on_init = function(client, _init_result)
		if client.root_dir then
			arduino_client_roots[client.id] = client.root_dir
		end
	end,
	on_exit = function(code, signal, client_id)
		local root_dir = arduino_client_roots[client_id]
		arduino_client_roots[client_id] = nil
		if root_dir then
			fail_arduino_startup(root_dir, code, signal)
		end
	end,
}

local arduino_progress_group = vim.api.nvim_create_augroup("arduino_lsp_progress", { clear = true })

vim.api.nvim_create_autocmd("LspProgress", {
	group = arduino_progress_group,
	callback = function(args)
		local data = args.data
		if not data or not data.client_id then
			return
		end

		local client = vim.lsp.get_client_by_id(data.client_id)
		if not client or client.name ~= "arduino_language_server" or not client.root_dir then
			return
		end

		arduino_client_roots[client.id] = client.root_dir
		local value = data.params and data.params.value
		if not value then
			return
		end

		if value.kind == "begin" or value.kind == "report" then
			finish_arduino_startup_from_progress(client.root_dir, value)
		elseif value.kind == "end" then
			finish_arduino_startup(client.root_dir)
		end
	end,
})

vim.lsp.config.ts_ls = {
	single_file_support = true,
	settings = {
		typescript = {
			inlayHints = {
				includeInlayParameterNameHints = "all",
				includeInlayParameterNameHintsWhenArgumentMatchesName = true,
				includeInlayFunctionParameterTypeHints = true,
				includeInlayVariableTypeHints = true,
				includeInlayVariableTypeHintsWhenTypeMatchesName = true,
				includeInlayPropertyDeclarationTypeHints = true,
				includeInlayFunctionLikeReturnTypeHints = true,
				includeInlayEnumMemberValueHints = true,
			},
		},
	},
}

vim.lsp.config["moonbit-lsp"] = {
	cmd = { "moonbit-lsp" },
	filetypes = { "moonbit" },
	single_file_support = true,
	settings = {
		rootMarkers = { "moon.mod.json", ".git" },
	},
}
