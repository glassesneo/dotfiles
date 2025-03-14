import {
  ActionFlags,
  Item,
  UiActionArguments,
} from "jsr:@shougo/ddu-vim@~10.1.0/types";
import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddu-vim@~10.1.0/config";

type Params = Record<string, unknown>;

export class Config extends BaseConfig {
  override config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchGlobal({
      uiOptions: {},
      sourceOptions: {
        ["_"]: {
          converters: ["converter_devicon"],
        },
      },
      filterParams: {
        matcher_ignore_files: {
          ignoreGlobs: [".DS_Store"],
        },
      },
    });

    args.contextBuilder.patchLocal("fuzzy_finder", {
      ui: "ff",
      uiOptions: {
        ff: {
          filterPrompt: "Search: ",
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
          statusline: false,
          floatingBorder: "rounded",
          winRow: "&lines / 2 - 2",
          winWidth: "(&columns - &columns % 2) / 2",
          previewFloating: true,
          previewFloatingBorder: "rounded",
          previewFloatingTitle: "Preview",
          previewHeight: 20,
          previewWidth: "(&columns - &columns % 2) / 2",
        },
      },
      sources: ["file_rec"],
      sourceOptions: {
        ["_"]: {
          matchers: ["matcher_substring", "matcher_ignore_files"],
          sorters: ["sorter_alpha"],
          // columns: ["filename"],
        },
      },
      sourceParams: {
        file_rec: {
          ignoredDirectories: [
            ".direnv",
            ".git",
            ".node_modules",
            "nimcache",
            "testresults",
          ],
        },
      },
      kindOptions: {
        ui_select: {
          defaultAction: "select",
        },
      },
    });

    args.contextBuilder.patchLocal("side_filer", {
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
            // filerOpenAndLeave: async (
            // args: UiActionArguments<Params>,
            // ): Promise<ActionFlags> => {
            // const item = await args.denops.call("ddu#ui#get_item") as Item;
            // if (item.isTree) {
            // await args.denops.call("ddu#ui#do_action", "expandItem", {
            // mode: "toggle",
            // isInTree: true,
            // });
            // } else {
            // await args.denops.call(
            // "ddu#ui#do_action",
            // "closePreviewWindow",
            // );
            // await args.denops.call("ddu#ui#do_action", "itemAction", {
            // name: "open",
            // params: { command: "wincmd l | drop" },
            // });
            // await args.denops.call("ddu#ui#async_action", "quit");
            // }
            // return Promise.resolve(ActionFlags.None);
            // },
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
