{delib, ...}:
delib.module {
  name = "programs.nixvim.dap";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins.dap = {
      enable = true;
      adapters.executables.codelldb = {
        command = "codelldb";
      };

      configurations = {
        c = [
          {
            name = "Launch executable";
            type = "codelldb";
            request = "launch";
            cwd = "\${workspaceFolder}";
            stopOnEntry = false;

            program.__raw = ''
              function()
                return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
              end
            '';
          }
        ];
      };
    };
  };
}
