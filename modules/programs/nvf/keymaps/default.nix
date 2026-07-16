{delib, ...}:
delib.module {
  name = "programs.nvf";

  home.ifEnabled = let
    swap = key1: key2: attrs: [
      (attrs
        // {
          key = key1;
          action = key2;
        })
      (attrs
        // {
          key = key2;
          action = key1;
        })
    ];
  in {
    programs.nvf.settings.vim.keymaps =
      [
        {
          key = "q";
          mode = ["n"];
          action = "<Nop>";
          silent = true;
        }
        {
          key = "<S-y>";
          mode = ["n"];
          action = "y$";
          silent = true;
        }
        {
          key = "<S-h>";
          mode = ["n"];
          action = "<Cmd>bprev<CR>";
          silent = true;
        }
        {
          key = "<S-l>";
          mode = ["n"];
          action = "<Cmd>bnext<CR>";
          silent = true;
        }
        {
          key = "<S-r>";
          mode = ["n"];
          action = "function() vim.lsp.buf.rename() end";
          lua = true;
          silent = true;
        }
        {
          key = "<C-a>";
          mode = ["i"];
          action = "<C-o>^";
          silent = true;
        }
        {
          key = "<C-e>";
          mode = ["i"];
          action = ''            function()
                        if vim.lsp.inline_completion.get() then
                          return ""
                        end
                        return "<C-o>$"
                      end'';
          lua = true;
          expr = true;
          silent = true;
        }
        {
          key = "<C-b>";
          mode = ["i"];
          action = "<Left>";
          silent = true;
        }
        {
          key = "<C-f>";
          mode = ["i"];
          action = "<Right>";
          silent = true;
        }
        {
          key = "<Space>h";
          mode = ["n" "x" "o"];
          action = "^";
          silent = true;
        }
        {
          key = "<Space>l";
          mode = ["n" "x" "o"];
          action = "$";
          silent = true;
        }
        {
          key = "M";
          mode = ["n" "x" "o"];
          action = "%";
          silent = true;
        }
        {
          key = ''a"'';
          mode = ["x" "o"];
          action = ''2i"'';
          silent = true;
        }
        {
          key = "a'";
          mode = ["x" "o"];
          action = "2i'";
          silent = true;
        }
        {
          key = "a`";
          mode = ["x" "o"];
          action = "2i`";
          silent = true;
        }
        {
          key = "x";
          mode = ["n" "x"];
          action = ''"_x'';
        }
        {
          key = "X";
          mode = ["n"];
          action = ''"_X'';
        }
        {
          key = "<C-s>";
          mode = ["i"];
          action = "<Cmd>update<CR>";
          silent = true;
        }
        {
          key = "y";
          mode = ["x"];
          action = "mzy`z";
          silent = true;
        }
        {
          key = "gc";
          mode = ["x"];
          action = "mz:normal gcc<CR>`z";
          silent = true;
        }
      ]
      ++ (swap "r" "<C-r>" {
        mode = ["n"];
        silent = true;
      });
  };
}
