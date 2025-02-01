import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddu-vim@~9.4.0/config";

export class Config extends BaseConfig {
  override config(args: ConfigArguments) {
    args.contextBuilder.patchLocal("floating_finder", {
      ui: "ff",
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
          prompt: "Search: ",
          winRow: "(&lines - &lines % 2) / 2 - 9",
          previewFloating: true,
          previewFloatingBorder: "rounded",
          previewFloatingTitle: "Preview",
          previewWidth: "(&columns - &columns % 2) / 2",
        },
      },
      sources: ["file_rec"],
      sourceOptions: {
        ["_"]: {
          matchers: ["matcher_substring", "matcher_ignore_files"],
          sorters: ["sorter_alpha"],
          converters: [],
          columns: ["icon_filename"],
        },
      },
      sourceParams: {
        file_rec: {
          ignoredDirectories: [
            ".git",
            "nimcache",
            "testresults",
            ".node_modules",
          ],
        },
      },
      filterParams: {
        matcher_ignore_files: {
          ignoreGlobs: ["testresults.html", ".DS_Store"],
        },
      },
      kindOptions: {
        ui_select: {
          defaultAction: "select",
        },
      },
    });
  }
}
