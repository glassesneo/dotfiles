import { BaseConfig } from "jsr:@shougo/ddc-vim@~10.2.0/config";
import type { ConfigArguments } from "jsr:@shougo/ddc-vim@~10.2.0/types";

export class Config extends BaseConfig {
  override async config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchGlobal({
      ui: "pum",
      autoCompleteEvents: ["InsertEnter", "TextChangedI", "TextChangedP"],
      sources: ["vim-lsp", "around", "file"],
      sourceOptions: {
        _: {
          matchers: ["matcher_fuzzy"],
          sorters: ["sorter_fuzzy"],
          converters: ["converter_remove_overlap", "converter_fuzzy"],
          ignoreCase: true,
          minAutoCompleteLength: 2,
        },
        "vim-lsp": { mark: "lsp", dup: "force",
          forceCompletionPattern: String.raw`\.\w*` },
        around: { mark: "A" },
        file: { mark: "F", isVolatile: true,
          forceCompletionPattern: String.raw`\S/\S*` },
        vim: { mark: "vim" },
      },
    });

    // TypeScript / JS: LSP first
    for (const ft of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
      args.contextBuilder.patchFiletype(ft, {
        sources: ["vim-lsp", "around", "file"],
      });
    }
    // Nix: LSP + around
    args.contextBuilder.patchFiletype("nix", {
      sources: ["vim-lsp", "around", "file"],
    });
    // Vim script: vim source first
    args.contextBuilder.patchFiletype("vim", {
      sources: ["vim", "around"],
    });
  }
}
