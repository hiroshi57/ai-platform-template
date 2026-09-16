# 教訓（LESSONS）— 失敗を基盤に変える

失敗は必ず次の4つのどれかになる。プロンプトを強い口調にするのではなく、
「欠けている能力は何か」を問う。

| 失敗の型 | 打ち手 |
|---------|-------|
| missing_context   | 地図/コンテキストを更新する（`context.mjs` / `product-rules.md`） |
| bad_tool_contract | ツールのスキーマを改善する（`gateway.mjs`） |
| missing_guardrail | ポリシーチェックを足す（`permissions.json`） |
| weak_verification | 回帰テストを足す（`verify.mjs` / `checks/`） |

## このデモで観測できること

- **証拠の粒度が修復可能性を決める**: `date_format` チェックがあるから、モデルは
  「日付形式が違う」と分かり ISO へ修復できる。チェックを消すと修復は空振りする。
- **停止条件は契約が決める**: 「何回粘るか」は `max_repairs`（契約）が決める。モデルではない。
- **提案・許可・実行は別物**: `send_message` の mode を変えるだけで、モデルのコードを
  1行も触らずに振る舞いが変わる。
