import { defineConfig } from "jsr:@yuki-yano/zeno";

export default defineConfig(() => ({
  snippets: [
    {
      name: "back directory",
      keyword: "bd",
      snippet: "cd ..",
    },
    {
      name: "neovim",
      keyword: "nv",
      snippet: "nvim",
    },
    {
      name: "claude-code",
      keyword: "cc",
      snippet: "claude",
    },
    {
      name: "codex",
      keyword: "cx",
      snippet: "codex",
    },
    {
      name: "opencode",
      keyword: "oc",
      snippet: "opencode",
    },
    {
      name: "git status",
      keyword: "gs",
      snippet: "git status --short --branch",
    },
    {
      name: "git add",
      keyword: "ga",
      snippet: "git add {{path}}",
    },
    {
      name: "git add -A",
      keyword: "gaa",
      snippet: "git add -A",
    },
    {
      name: "git commit",
      keyword: "gc",
      snippet: "git commit",
    },
    {
      name: "git commit message",
      keyword: "gcim",
      snippet: "git commit -m '{{commit_message}}'",
    },
    {
      name: "git diff",
      keyword: "gd",
      snippet: "git diff",
    },
    {
      name: "git diff --stat",
      keyword: "gdst",
      snippet: "git diff --stat",
    },
    {
      name: "git diff --staged",
      keyword: "gds",
      snippet: "git diff --staged",
    },
    {
      name: "git diff --staged --stat",
      keyword: "gdss",
      snippet: "git diff --staged --stat",
    },
    {
      name: "git grep",
      keyword: "gg",
      snippet: "git grep",
    },
    {
      name: "git log",
      keyword: "gl",
      snippet: "git log --graph --decorate",
    },
    {
      name: "git log graph",
      keyword: "glg",
      snippet: "git log --oneline --graph --decorate -n 20",
    },
    {
      name: "pbcopy",
      keyword: "pc",
      "snippet": "pbcopy",
    },
    {
      name: "pbpaste",
      keyword: "pp",
      "snippet": "pbpaste",
    },
    {
      name: "home-manager activation",
      keyword: "nhh",
      snippet: "nh home switch -c {{configuration}}@ -Lt",
    },
    {
      name: "nix-darwin activation",
      keyword: "nhd",
      snippet: "nh darwin switch . -H {{host}} -Lt",
    },
  ],
}));
