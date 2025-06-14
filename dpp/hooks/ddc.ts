import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddc-vim@~9.4.0/config";

export class Config extends BaseConfig {
  override async config(args: ConfigArguments): Promise<void> {
    const commonSources = [
      "around",
      // "copilot",
      "rg",
      "buffer",
      "file",
      "skkeleton",
    ];
    const commonLangSources = ["lsp", "denippet"].concat(commonSources);
    const headMatchers = ["matcher_head", "matcher_prefix"];
    const commonConverters = [
      "converter_truncate_abbr",
      "converter_remove_overlap",
    ];
    const fuzzyMatchers = ["matcher_fuzzy"];
    const fuzzySorters = ["sorter_fuzzy"];
    const fuzzyConverters = ["converter_fuzzy"].concat(commonConverters);
    args.contextBuilder.patchGlobal({
      ui: "pum",
      sources: commonSources,
      autoCompleteEvents: [
        "InsertEnter",
        "TextChangedI",
        "TextChangedP",
        "InsertEnter",
        "CmdlineEnter",
        "CmdlineChanged",
      ],
      cmdlineSources: {
        ":": ["file", "cmdline", "cmdline_history", "around"],
        "/": commonSources,
      },
      sourceOptions: {
        _: {
          matchers: headMatchers,
          sorters: ["sorter_rank"],
          converters: commonConverters,
          minAutoCompleteLength: 1,
          enabledIf: "!skkeleton#is_enabled()",
        },
        around: {
          mark: "[around]",
          matchers: fuzzyMatchers,
          sorters: fuzzySorters,
          converters: fuzzyConverters,
        },
        buffer: {
          mark: "[buf]",
        },
        copilot: {
          mark: " ",
          matchers: [],
          minAutoCompleteLength: 0,
        },
        cmdline: {
          mark: "[>_]",
          forceCompletionPattern: "\\S/\\S*|\\.\\w*",
          minAutoCompleteLength: 1,
          dup: "force",
        },
        cmdline_history: {
          mark: "[>_] his",
          sorters: [],
          minAutoCompleteLength: 1,
        },
        denippet: {
          mark: "[denippet]",
          dup: "keep",
          matchers: headMatchers,
          sorters: ["sorter_rank"],
          converters: [],
        },
        file: {
          mark: "[file]",
          forceCompletionPattern: "S/S*",
          isVolatile: true,
        },
        line: {
          mark: "[line]",
          matchers: fuzzyMatchers,
          sorters: fuzzySorters,
          converters: fuzzyConverters,
        },
        lsp: {
          mark: "[LSP]",
          matchers: fuzzyMatchers,
          minAutoCompleteLength: 1,
          sorters: ["sorter_lsp-kind"],
          converters: ["converter_kind_labels"].concat(fuzzyConverters),
          forceCompletionPattern: "\.\w*|:\w*|->\w*",
          dup: "force",
        },
        "nvim-lua": {
          mark: "[lua]",
          matchers: fuzzyMatchers,
          sorters: fuzzySorters,
          converters: fuzzyConverters,
          forceCompletionPattern: "/w*",
        },
        rg: {
          mark: "[rg]",
          matchers: fuzzyMatchers,
          sorters: fuzzySorters,
          converters: fuzzyConverters,
          // minAutoCompleteLength: 6,
        },
        shell_native: {
          mark: "[sh]",
          matchers: headMatchers,
          sorters: ["sorter_rank"],
          converters: commonConverters,
          isVolatile: true,
          forceCompletionPattern: "\\S/\\S*",
        },
        skkeleton: {
          mark: "[SKK]",
          matchers: [],
          sorters: [],
          converters: [],
          isVolatile: true,
          minAutoCompleteLength: 2,
          enabledIf: "",
        },
        treesitter: {
          mark: "[TS]",
          matchers: fuzzyMatchers,
          sorters: fuzzySorters,
          converters: fuzzyConverters,
        },
      },
      sourceParams: {
        buffer: {
          limitBytes: 5000000,
          forceCollect: true,
        },
        copilot: {
          copilot: "lua",
        },
        lsp: {
          enableAdditionalTextEdit: true,
          enableDisplayDetail: true,
          enableMatchLabel: true,
          enableResolveItem: true,
          lspEngine: "nvim-lsp",
          snippetEngine: async (body: string) => {
            await args.denops.call("denippet#anonymous", body);
          },
        },
        shell_native: {
          shell: "zsh",
        },
      },
      postFilters: ["postfilter_score"],
      filterParams: {
        converter_fuzzy: {
          hlGroup: "Title",
        },
        postfilter_score: {
          hlGroup: "",
        },
        converter_kind_labels: {
          kindLabels: {
            Text: "󰉿 text",
            Method: "󰆧 method",
            Function: "󰊕 function",
            Constructor: " constructor",
            Field: "󰜢 field",
            Variable: "󰀫 variable",
            Class: "󰠱 class",
            Interface: " interface",
            Module: " module",
            Property: "󰜢 property",
            Unit: "󰑭 unit",
            Value: "󰎠 value",
            Enum: " enum",
            Keyword: "󰌋 keyword",
            Snippet: " snippet",
            Color: "󰏘 color",
            File: "󰈙 file",
            Reference: "󰈇 reference",
            Folder: "󰉋 folder",
            EnumMember: " enum member",
            Constant: "󰏿 constant",
            Struct: "󰙅 struct",
            Event: " event",
            Operator: "󰆕 operator",
            TypeParameter: " type parameter",
          },
          kindHlGroups: {
            Method: "Function",
            Function: "Function",
            Constructor: "Function",
            Field: "Identifier",
            Variable: "Identifier",
            Class: "Structure",
            Interface: "Structure",
          },
        },
      },
      uiParams: {
        "ui-pum": {
          insert: false,
        },
      },
      backspaceCompletion: true,
    });

    const enabledFiletypes = [
      "bash",
      "elm",
      "go",
      "haskell",
      "lhaskell",
      "lua",
      "nim",
      "nix",
      "nu",
      "python",
      "scala",
      "sql",
      "mysql",
      "sh",
      "svelte",
      "toml",
      "typescript",
      "typescriptreact",
      "javascript",
      "kotlin",
      "v",
      "vsh",
      "vv",
      "zig",
      "zir",
    ];
    for (const ft of enabledFiletypes) {
      args.contextBuilder.patchFiletype(ft, { sources: commonLangSources });
    }

    args.contextBuilder.patchFiletype("deol", {
      specialBufferCompletion: true,
      sources: ["shell_native"].concat(commonSources),
      sourceOptions: {
        _: {
          keywordPattern: "[0-9a-zA-Z_./#:-]*",
        },
      },
    });
    await Promise.resolve();
  }
}
