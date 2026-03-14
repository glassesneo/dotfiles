import { defineConfig } from "jsr:@yuki-yano/zeno";

export default defineConfig(() => ({
  snippets: [
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
      name: "git diff --staged",
      keyword: "gds",
      snippet: "git diff --staged",
    },
    {
      name: "git log graph",
      keyword: "glg",
      snippet: "git log --oneline --graph --decorate -n 20",
    },
    {
      name: "nix flake update",
      keyword: "nfu",
      snippet: "nix flake update",
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
