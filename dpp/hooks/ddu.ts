import {
  ActionFlags,
  Item,
  UiActionArguments,
} from "jsr:@shougo/ddu-vim@~10.1.0/types";
import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddu-vim@~10.1.0/config";
import { nvim_replace_termcodes } from "jsr:@denops/std@~7.5.0/function/nvim";
import { feedkeys } from "jsr:@denops/std@~7.5.0/function";

type Params = Record<string, unknown>;

export class Config extends BaseConfig {
  override config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchGlobal({
      uiOptions: {
        ff: {
          actions: {},
        },
      },
      uiParams: {
        ff: {
          statusline: false,
          floatingBorder: "single",
        },
      },
      filterParams: {
        matcher_ignore_files: {
          ignoreGlobs: [".DS_Store"],
        },
        matcher_kensaku: {
          highlightMatched: "Search",
        },
      },
    });

    args.contextBuilder.patchLocal("fuzzy_finder", {
      ui: "ff",
      uiOptions: {
        ff: {
          filterPrompt: "search: ",
          actions: {
            escape: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await feedkeys(
                args.denops,
                await nvim_replace_termcodes(
                  args.denops,
                  "<Esc>",
                  true,
                  false,
                  true,
                ),
                "n",
              );
              return ActionFlags.None;
            },
            openAndEscape: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await args.denops.call("ddu#ui#do_action", "itemAction", {
                name: "open",
              });
              await feedkeys(
                args.denops,
                await nvim_replace_termcodes(
                  args.denops,
                  "<Esc>",
                  true,
                  false,
                  true,
                ),
                "n",
              );
              return ActionFlags.None;
            },
            grepFile: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await args.denops.call("ddu#ui#do_action", "openAndEscape");
              await args.denops.call("ddu#start", { name: "line_greper" });
              return ActionFlags.None;
            },
          },
        },
      },
      uiParams: {
        ff: {
          startAutoAction: true,
          autoAction: {
            delay: 0,
            name: "preview",
            // sync: false,
          },
          split: "floating",
          floatingTitle: "ddu-fuzzy_finder",
          winRow: "&lines / 2 - 20",
          winCol: "&columns / 2 - eval(uiParams.winWidth) - 17",
          winWidth: "(&columns - &columns % 2) / 4 - 10",
          winHeight: 40,
          previewSplit: "vertical",
          previewFloating: true,
          previewFloatingBorder: "double",
          previewFloatingTitle: "Preview",
          previewRow: "$lines / 2 - 20",
          // previewCol: "(&columns - &columns % 2) / 3",
          // previewWidth: "(&columns - &columns % 2) / 2",
          previewHeight: 40,
        },
      },
      sources: [
        {
          name: "file_rec",
          options: {
            matchers: ["matcher_substring", "matcher_ignore_files"],
            sorters: ["sorter_alpha"],
            converters: ["converter_devicon"],
          },
          params: {
            ignoredDirectories: [
              ".direnv",
              ".git",
              ".node_modules",
              "nimcache",
              "testresults",
            ],
          },
        },
      ],
    });

    args.contextBuilder.patchLocal("line_greper", {
      ui: "ff",
      uiOptions: {
        ff: {
          filterPrompt: "grep: ",
          actions: {
            escape: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await feedkeys(
                args.denops,
                await nvim_replace_termcodes(
                  args.denops,
                  "<Esc>",
                  true,
                  false,
                  true,
                ),
                "n",
              );
              return ActionFlags.None;
            },
            openAndEscape: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await args.denops.call("ddu#ui#do_action", "itemAction", {
                name: "open",
              });
              await feedkeys(
                args.denops,
                await nvim_replace_termcodes(
                  args.denops,
                  "<Esc>",
                  true,
                  false,
                  true,
                ),
                "n",
              );
              return ActionFlags.None;
            },
          },
        },
      },
      uiParams: {
        ff: {
          startAutoAction: true,
          autoAction: {
            delay: 0,
            name: "preview",
          },
          split: "floating",
          floatingTitle: "ddu-line_greper",
          winRow: "&lines / 2 - 4",
          winWidth: "(&columns - &columns % 2) / 2",
          previewFloating: true,
          previewFloatingBorder: "double",
          previewFloatingTitle: "Preview",
          previewHeight: 15,
          previewWidth: "(&columns - &columns % 2) / 2",
        },
      },
      sources: [
        {
          name: "line",
          options: {
            matchers: ["matcher_kensaku"],
          },
        },
      ],
    });

    args.contextBuilder.patchLocal("message_greper", {
      ui: "ff",
      uiOptions: {
        ff: {
          filterPrompt: "grep: ",
          actions: {
            openAndEscape: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              await args.denops.call("ddu#ui#do_action", "itemAction", {
                name: "open",
              });
              await feedkeys(
                args.denops,
                await nvim_replace_termcodes(
                  args.denops,
                  "<Esc>",
                  true,
                  false,
                  true,
                ),
                "n",
              );
              return ActionFlags.None;
            },
          },
        },
      },
      uiParams: {
        ff: {
          split: "floating",
          floatingTitle: "ddu-message_greper",
          // winRow: "&lines / 2 - 4",
          winWidth: "(&columns - &columns % 2) / 2",
        },
      },
      sources: [
        {
          name: "message",
          options: {
            matchers: ["matcher_kensaku"],
          },
        },
      ],
    });

    args.contextBuilder.patchLocal("tree_filer", {
      ui: "filer",
      uiOptions: {
        filer: {
          actions: {
            updatePreview: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              const item = await args.denops.call("ddu#ui#get_item") as Item;
              if (item.isTree) {
                args.denops.call("ddu#ui#do_action", "closePreviewWindow");
              } else {
                args.denops.call("ddu#ui#do_action", "preview");
              }
              return Promise.resolve(ActionFlags.None);
            },
            filerOpen: async (
              args: UiActionArguments<Params>,
            ): Promise<ActionFlags> => {
              const item = await args.denops.call("ddu#ui#get_item") as Item;
              if (item.isTree) {
                await args.denops.call("ddu#ui#do_action", "expandItem", {
                  mode: "toggle",
                  isInTree: true,
                });
              } else {
                await args.denops.call(
                  "ddu#ui#do_action",
                  "closePreviewWindow",
                );
                await args.denops.call("ddu#ui#do_action", "itemAction", {
                  name: "open",
                  params: { command: "wincmd l | drop" },
                });
              }
              return Promise.resolve(ActionFlags.None);
            },
          },
        },
      },
      uiParams: {
        filer: {
          startAutoAction: true,
          autoAction: {
            delay: 0,
            name: "updatePreview",
          },
          displayRoot: false,
          sortTreesFirst: true,
          split: "vertical",
          splitDirection: "topleft",
          statusline: false,
          winWidth: 25,
          previewSplit: "no",
        },
      },
      sources: ["file"],
      sourceOptions: {
        ["_"]: {
          matchers: [],
          sorters: ["sorter_alpha"],
          converters: ["converter_devicon"],
          columns: ["filename"],
        },
        file: {},
      },
      kindOptions: {
        file: {},
      },
      actionOptions: {
        open: {
          quit: false,
        },
      },
    });

    return Promise.resolve();
  }
}
