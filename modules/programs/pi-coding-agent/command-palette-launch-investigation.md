# Pi Command Palette 起動問題の調査引き継ぎ

## 文書の目的

この文書は、Pi 0.80.7 用 Command Palette の初期実装から現在までの変更、検証結果、実環境で残っている `Ctrl+Shift+P` の二回押し問題、未確認事項を記録する。

実装者の環境では対話的な再現試験を実施していないため、原因は未特定である。

## 対象環境

利用者が問題を確認した入力経路は次のとおりである。

```text
ホスト macOS
  └─ Kitty
      └─ SSH
          └─ VM の macOS
              └─ tmux
                  └─ Pi 0.80.7
```

利用者の当初の観測では、`Ctrl+Shift+P` の一回目では画面が変化せず、二回目で Command Palette が開いていた。

その後の利用者による調査で、原因はホスト macOS 上の Kitty 設定だと判明した。

Kitty の設定変更後は、Pi 側の shortcut 実装だけで一回の入力から起動することを利用者が確認した。

## 統治仕様と実装計画

初期実装は次の artifact に基づく。

- 仕様：`.agents/specs/20260719-195955-pi-command-palette-orthogonal-actions-keybindings-revision.md`
- 基準仕様：`.agents/specs/20260719-194316-pi-command-palette-orthogonal-actions.md`
- 計画：`.agents/plans/20260719-200348-pi-command-palette-initial-implementation-revision-1.md`

基準仕様は、未送信のプロンプト下書きを読まず、変更せず、送信しないことを要求している。

初期仕様では non-overlay の `ctx.ui.custom()` を選んでいたが、利用者の期待に合わせるため、現在の実装は Pi の experimental overlay API を使用している。

## 初期実装

初期実装では `pi.registerShortcut("ctrl+shift+p", ...)` から Command Palette を起動した。

パレットは non-overlay の `ctx.ui.custom()` でプロンプト領域を一時的に置き換えた。

この実装はエディタ文字列 APIを呼ばず、Pi 自身の custom UI lifecycle に下書きの保存と復元を任せた。

候補一覧では `Ctrl+P` を上移動、`Ctrl+N` を下移動、`Enter` を実行、`Escape` と `Ctrl+C` をキャンセルに割り当てた。

初期 action registry には次の七項目だけを明示的に登録した。

- model selection
- reasoning effort selection
- active tool configuration
- tool output expansion toggle
- session information
- last assistant response copy
- theme selection

`pi.getCommands()`、prompt template、Skill、shell command は action registry に取り込んでいない。

初期実装後の自動検証では TypeScript check と全74テストが成功した。

利用者の試験では、初期実装の時点で `Ctrl+Shift+P` を二回押さないとパレットが開かなかった。

## 利用者のフィードバック後の変更

利用者から次の三点が報告された。

1. `Ctrl+Shift+P` を二回押さないと起動しない。
2. プロンプト領域の置換ではなく、画面中央のポップアップを期待していた。
3. 各 action の英文名の前に `/model` のような短いラベルが必要だった。

表示については、全 palette-owned screen を中央配置の overlay に変更した。

現在の overlay 設定は次のとおりである。

```ts
{
    overlay: true,
    overlayOptions: {
        anchor: "center",
        width: "72%",
        minWidth: 48,
        maxHeight: "80%",
        margin: 1,
    },
}
```

長い model list と tool list が overlay の高さを超えないように、選択位置を中心とした表示 window と上下の残件数表示を追加した。

Action label は次の対応に変更した。

| Label | Action |
|---|---|
| `/model` | Select model |
| `/thinking` | Select reasoning effort |
| `/tools` | Configure active tools |
| `/tool-output` | Toggle tool output expansion |
| `/session` | Show session information |
| `/copy` | Copy last assistant response |
| `/theme` | Select theme |

## 二回押し問題に対して試した変更

最初の実装は Pi の extension shortcut API だけを使用していた。

Pi の配布コードを確認すると、extension shortcut handler は既定 editor に設定され、`CustomEditor` へ editor ownership が移るときに `onExtensionShortcut` がコピーされる。

このリポジトリの `InteractionPolicyEditor` は `CustomEditor` を継承し、`Ctrl+C` 以外を `super.handleInput(data)` へ渡す。

そのため、ソース上は `interaction_policy.ts` が `Ctrl+Shift+P` を遮断する構造にはなっていなかった。

原因をPi側と仮定した暫定対策として、二回目の実装では `ctx.ui.onTerminalInput()` を追加した。

Raw input listener は focused component より前に入力を consume し、同じ open処理を直接開始する構成だった。

しかし、利用者の再試験では raw listener の追加後も二回押しが必要だった。

ホスト側のKitty設定が原因だと判明したため、この raw listener は不要であり、Pi の標準入力経路を迂回する処理として削除した。

現在は `pi.registerShortcut()` だけが起動キーを所有する。

連続入力による多重起動を防ぐ `opening` flag は、shortcut方式でも意味があるため維持した。

## 自動テストで確認した範囲

暫定対策のテストでは、Kitty/CSI-u 形式の `Ctrl+Shift+P` を表す `"\u001b[112;6u"` を raw listener へ渡し、一入力で custom UI が開くことを確認していた。

しかし、このテストは実際の Kitty、SSH、tmux、Pi の keyboard protocol negotiation を通しておらず、実環境の原因を検出できなかった。

Raw listener の削除後は、`pi.registerShortcut("ctrl+shift+p", ...)` に登録した handler を一回呼び出すと custom UI が一回だけ開くことをテストしている。

実際の端末入力列から shortcut handler までの変換は Pi TUI と端末設定の責任範囲であり、この extension の unit test では再実装しない。

修正後の自動検証では TypeScript check と全テストが成功した。

```sh
cd modules/programs/pi-coding-agent
npm run check
```

Treefmt check も成功した。

```sh
nix build .#checks.aarch64-darwin.treefmt --no-link
```

Home Manager evaluation では、`command_palette.ts` と `command-palette-keybindings.json` が生成設定へ登録されることを確認した。

`nix flake check` と代表 Home Manager build は、Command Palette と無関係な既存の Sketchybar build error で停止した。

失敗内容は、Nix store source 内で次の tracked file を参照できないというものだった。

```text
modules/services/sketchybar/widgets/workspace/providers/aerospace.nu
```

## 現在確認できている Pi と tmux の設定

Home Manager の Pi keybindings では、組み込み `app.model.cycleForward` と `app.model.cycleBackward` を空配列にしている。

したがって、Home Manager 設定が適用済みであれば、`Ctrl+Shift+P` が組み込み model cycle に予約される設定上の競合はない。

VM 側の tmux 設定には次の設定がある。

```tmux
set -g default-terminal "tmux-256color"
set -g extended-keys always
set -g extended-keys-format csi-u
set -as terminal-features ',xterm*:extkeys'
```

VM host configuration には Kitty terminfo package も登録されている。

これらの設定は extended key を通す意図には合っているが、実行中の tmux server が同じ設定を読み込んだことと、一回目の実バイト列は未確認である。

## 原因と実装判断

二回押し問題の原因は、ホスト macOS 上の Kitty 設定だった。

Kitty の設定変更後に一回で起動したため、Pi extension 内に二重の入力処理を残す理由はない。

Raw input listener は Pi の shortcut競合診断と通常の editor shortcut dispatch を迂回し、session context の保持と listener lifecycle も extension側で管理する必要がある。

一方、`pi.registerShortcut()` は Pi 0.80.7 が公開する本来の拡張点であり、`/hotkeys`、競合診断、custom editor へのhandler伝播をPi側に任せられる。

この差に基づき、起動処理は初期実装の `pi.registerShortcut()` 方式へ戻した。

中央 overlay、action labels、共通 list controller は二回押し問題と独立した利用者要件なので維持した。

## 再発時に取得すべき証拠

同じ症状が再発した場合は、Pi extension の `onTerminalInput` handler を一時的な診断用途だけに追加し、各入力の時刻、文字列表現、UTF-8 hex を一時ファイルへ記録する。

例として、次の情報を `/tmp/pi-command-palette-input.jsonl` へ追記する。

```ts
{
    timestamp: new Date().toISOString(),
    json: JSON.stringify(data),
    hex: Buffer.from(data, "utf8").toString("hex"),
}
```

Console 出力は TUI rendering と混ざるため、調査用ログには使わない。

一回目と二回目の記録を比較すれば、「入力が届かない」「別 sequence が届く」「同じ sequence だが起動しない」を分離できる。

次に、同じログ取得を次の経路で比較する。

1. VM のローカル terminal から Pi を起動する。
2. Kitty から SSH 接続し、tmux を使わず Pi を起動する。
3. Kitty から SSH 接続し、tmux 内で Pi を起動する。

この比較により、問題が SSH より前、SSH と tmux の間、tmux と Pi の間のどこで発生するかを絞り込める。

実行中の terminal state は次のコマンドでも確認する。

```sh
printf 'TERM=%s\nTERM_PROGRAM=%s\n' "$TERM" "$TERM_PROGRAM"
tmux show-options -gv extended-keys
tmux show-options -gv extended-keys-format
tmux show-options -g terminal-features
```

Standalone の raw-mode script だけでは Pi が行う keyboard protocol negotiation を再現できない可能性がある。

そのため、最初の証拠は Pi process 内の `onTerminalInput` で取得する。

## 関連する実装ファイル

- `modules/programs/pi-coding-agent/extensions/command_palette.ts`
- `modules/programs/pi-coding-agent/extensions/utilities/command_palette_core.ts`
- `modules/programs/pi-coding-agent/extensions/utilities/command_palette_keymap.ts`
- `modules/programs/pi-coding-agent/extensions/utilities/command_palette_tui.ts`
- `modules/programs/pi-coding-agent/extensions/utilities/command-palette-keybindings.json`
- `modules/programs/pi-coding-agent/tests/command_palette.test.ts`
- `modules/programs/pi-coding-agent/tests/command_palette_core.test.ts`
- `modules/programs/pi-coding-agent/tests/command_palette_keymap.test.ts`
- `modules/programs/pi-coding-agent/tests/command_palette_tui.test.ts`
- `modules/programs/pi-coding-agent/default.nix`
- `modules/programs/pi-coding-agent/README.md`

## 現在の実装状態

Command Palette はPiのextension shortcut APIで起動し、中央 overlay、action labels、palette-local navigationを提供する。

調査時に追加したraw terminal input listenerと最新contextの独自保持処理は削除済みである。
