import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddu-vim@~9.4.0/config";

export class Config extends BaseConfig {
  override config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchLocal("side_filer", {
      ui: "filer",
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
          converters: [],
        },
        file: {
          columns: ["icon_filename"],
        },
      },
      filterParams: {
        matcher_ignore_files: {
          ignoreGlobs: [".DS_Store"],
        },
      },
      kindOptions: {
        file: {
          defaultAction: "open",
        },
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
