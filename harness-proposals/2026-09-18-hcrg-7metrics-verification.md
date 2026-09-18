# Harness 改善提案: HCRG 由来「7 SE 指標を検証コマンド／レビュー観点に落とす」

- **日付**: 2026-09-18
- **slug**: `hcrg-7metrics-verification`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— CLAUDE.md §7 の運用に従い、承認前は本体ファイル（CLAUDE.md / AGENTS.md / skills / frontmatter / `agent-harness/src/verify.mjs`）へ反映しない
- **根拠論文**: *Beyond Vector Similarity: Hierarchical Context-Aware Graph RAG vs Standard RAG in Enterprise Code Migration*
  - Jaiswal, Shukla, Malhotra, Agrawal, Garg, Bhaumik, Puri (Google Cloud) — arXiv:2609.12464v1 [cs.AI], 2026-09-11
  - サンプルリポジトリ: https://github.com/spring-petclinic/spring-petclinic-ai

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には一切触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は **検証コマンドの粒度**と **Reviewer / Worker self_review の観点**のみ。安全上のハードキャップ（自動修正3回・相談3回）も変更しない。
>
> ⚠️ **提案の性質**: 論文は Java→Python の「コード移行」タスク専用の評価枠組み。本ハーネスは移行に限らない汎用実装ワークなので、7指標は **アナロジーによる検証観点**として移植する。論文の数値（DRQ +31.1% 等）は本ハーネスに転用保証しない。価値は「表面 diff 一致では壊れたコードを見抜けない」という論文の中核実証を、**具体的な runnable コマンド**に固定することにある。

## TL;DR（3行要約）

- **主張**: 論文は「**CodeBLEU（字面のN-gram重複）は壊れたコードを見抜けない**（両手法とも91%だが実態は雲泥）。構造的な実用性は AST ベースの7指標でしか測れない」を実証。本ハーネスの `verify.mjs` 証拠ゲートと self_review も、同じく「良さそう」でなく「**構造チェックが通った**」を停止条件にしている（設計思想が一致）。
- **提案**: 論文の7 SE指標を **(A) 言語別 runnable 検証コマンド集**と **(B) Reviewer / self_review の観点** に翻訳し、`validation_commands` 選定と review artifact の判断材料を密にする。特に既存ハーネスに**無い観点**＝ **CCC（過剰設計ガード）**と **Global Lookup（幻覚の誤検知を防ぐ repo 横断確認）**を追加する。
- **効果**: いずれも既存ツール（ruff / pytest / mypy / radon / node）で実装可、新規基盤・モデル変更不要。§5 で実測して確認する。

### 承認で決まること（決裁事項）

- ✅ §2 の**7指標↔検証コマンド対応表を共通語彙として採用**する
- ✅ §3 の**言語別コマンド集を `validation_commands` の推奨セットとして参照してよい**
- ✅ §4 の**2観点（CCC 過剰設計ガード / Global Lookup 幻覚判定）を Reviewer 観点と self_review rule 候補に加えてよい**
- ❌ 承認しても本体ファイル（skills / verify.mjs）への反映は**別途レビュー**を経る（本承認は一括反映の許可ではない）
- ❌ self_review の既定5 rule の**置き換えではない**。追加候補の提示であり、採否はプロジェクト単位（`harness.toml [worker.self_review]`）

**却下・保留する場合**: 指標単位で可（7指標は相互に独立採用可能）。

---

## 1. 背景: 論文の中核と本ハーネスの構造対応

論文の核心は「**syntactic resemblance ≠ architectural viability**（字面が似ている ≠ 動く）。CodeBLEU は局所文字列重複に強くバイアスし、壊れた API 契約や幻覚 import を罰せない」。そこで Python の `ast` モジュール（構造検証）＋ `pyflakes`（静的解析）＋ `lizard`（複雑度）で7指標を決定論的に算出する。

本ハーネスの既存機構と一対一で対応する:

| 論文（HCRG 評価）| 本ハーネス | 対応の性質 |
|---|---|---|
| CodeBLEU では壊れたコードを見抜けない | `verify.mjs` 冒頭「"良さそう"は停止条件ではない。"チェックが全部通った"が停止条件」 | **同一原則** |
| 7 SE 指標（決定論的プログラム評価）| `verify.mjs` の evidence 配列（output_schema / date_format / fixture_match …）| 同型（チェックの粒度＝修復可能性）|
| 検証の粒度が修復可能性を決める | verify.mjs の実験コメント「date_format を消すと修復が空振る」 | **同一原則** |
| MQ 加重合成スコア | self_review の DoD 検証（evidence 付き）| 類似 |
| Global Lookup（repo 横断で幻覚判定）| （**該当機構なし**）| 新規追加候補 |
| CCC（過剰設計の検出）| （**該当機構なし**）| 新規追加候補 |

**含意**: 本ハーネスは既に「証拠ゲート」「粒度が修復可能性を決める」という論文と同じ思想を持つ。欠けているのは **(a) 検証コマンドの具体カタログ**と **(b) 過剰設計・幻覚誤検知という2つの観点**である。

---

## 2. 7指標 ↔ 検証コマンド／レビュー観点 対応表（コア成果物）

| # | 論文指標 | 論文での測り方 | 本ハーネスでの検証コマンド | Reviewer / self_review 観点 |
|---|---|---|---|---|
| 1 | **CMQ**（移行品質・加重合成）| DRQ40%+継承30%+型20%+構文10% | 下記2〜7の集約（単一スコア化はしない）| DoD 各項目が下記チェックで裏取りされているか |
| 2 | **DRQ**（依存・API解決）| AST で import 抽出→stdlib/whitelist 照合→`find_spec` で存在確認。幻覚ライブラリは減点 | Python: `python -c "import ast,importlib.util,sys; ..."`（§3.1）／実際に `python -c "import <mod>"` / `pytest --collect-only`。JS: `node --check` / `npm run build` | 新規 import が**実在するモジュールに解決するか**。幻の API を呼んでいないか |
| 3 | **PCC**（親子・継承一貫性）| 元コードの `extends`/`implements` を正規表現抽出→生成側 `ast.ClassDef.bases` と照合。幻の親／継承漏れをフラグ | リファクタ時: `git diff` で基底クラス・実装インターフェース・抽象メソッドが**保存されているか** grep 確認。既存テストの継承系ケースが PASS | 契約（基底クラス・protocol・型）を壊していないか。幻の親クラスを発明していないか |
| 4 | **THC**（型ヒント充足）| `FunctionDef` 走査、型付き引数比率＋`returns` 有無（self/cls 除外）| Python: `mypy <changed_files>` または `ruff check --select ANN`（未導入なら参考値）。TS: `tsc --noEmit` | 新規関数に型ヒント／戻り値型があるか（既存コードの型密度を下回らないか）|
| 5 | **StaQ**（静的解析／lint）| `pyflakes` で構文＋未使用/未定義変数チェック。1件10点減点 | **既存導入済**: Python `ruff check .`（pyproject に F/E/W/I/B/UP/S 設定済）／`python -m py_compile`。JS `node --check`。TS `eslint` | lint ゼロ違反。未定義/未使用変数なし |
| 6 | **CCC**（循環的複雑度の一貫性）| `lizard` で元/生成の複雑度を算出、絶対偏差％。偏差2 or 10%以内は「一貫」| Python: `radon cc <changed_files> -s -a`（変更前後で比較）。閾値超は要説明 | **過剰設計ガード**: 元より不必要に複雑化していないか。遠いエッジケースへの防御的過剰実装をしていないか（§4.1）|
| 7 | **DP**（docstring 保持）| 元の JavaDoc が Python docstring に引き継がれたか | `git diff` で既存関数/クラスの docstring・コメントが**削除されていないか**確認。`ruff --select D`（任意）| リファクタで既存の docstring/コメントを落としていないか（注意希釈の兆候）|

> **Global Lookup（幻覚判定の誤検知防止）**: 論文は「他モジュールで定義された正当な内部呼び出しを、ファイル単位チェックが誤って幻覚とフラグする」問題を Global Symbols Table（repo 全体）で解決した。→ 本ハーネスの Reviewer 観点に転用（§4.2）。

---

## 3. 言語別 検証コマンド集（`validation_commands` 推奨セット）

Worker は「`validation_commands` 未指定なら既存 script から選び理由を1行残す」規約。以下を選定の**参照カタログ**として使う（全部必須ではない。変更ファイルの言語に応じて選ぶ）。

### 3.1 Python（本 repo の主言語: ruff + pytest, py39）

```bash
# StaQ: 静的解析（導入済 — 最優先）
ruff check .
# 構文（幻覚 import の一次検出 = DRQ の軽量版）
python -m py_compile $(git diff --name-only HEAD -- '*.py')
# DRQ: import 実在チェック（変更ファイルの import が解決するか）
python -c "import ast,importlib.util,sys,pathlib
bad=[]
for f in sys.argv[1:]:
    t=ast.parse(pathlib.Path(f).read_text(encoding='utf-8'))
    for n in ast.walk(t):
        mods=[a.name for a in getattr(n,'names',[])] if isinstance(n,ast.Import) else ([n.module] if isinstance(n,ast.ImportFrom) and n.level==0 and n.module else [])
        for m in mods:
            top=m.split('.')[0]
            if top in sys.stdlib_module_names: continue
            if importlib.util.find_spec(top) is None: bad.append((f,m))
print('UNRESOLVED IMPORTS:',bad) or (sys.exit(1) if bad else None)" $(git diff --name-only HEAD -- '*.py')
# 検証の本丸: テスト（黙ってスキップさせない設定は pyproject 済）
pytest
# THC: 型（mypy 未導入なら任意。導入時のみ）
mypy $(git diff --name-only HEAD -- '*.py') 2>/dev/null || echo "mypy 未導入: skip"
# CCC: 複雑度（radon 導入時のみ。過剰設計ガード §4.1）
radon cc $(git diff --name-only HEAD -- '*.py') -s -a 2>/dev/null || echo "radon 未導入: skip"
```

### 3.2 JS / Node（`agent-harness/src/*.mjs`, `frontend/`）

```bash
# StaQ/DRQ: 構文＋import 解決の一次チェック
for f in $(git diff --name-only HEAD -- '*.mjs' '*.js'); do node --check "$f"; done
# frontend: ビルドが通る（型/依存解決の実質チェック）
cd frontend && npm run build
# eslint / tsc は導入時のみ（現状 frontend は素の JS）
```

### 3.3 集約の考え方

- **単一スコアにしない**。論文の MQ は研究用の加重合成だが、本ハーネスは `verify.mjs` 流儀で**個別 evidence を並べる**方が修復可能性が高い（粒度の原則）。
- 各コマンドの生出力は `harness-logs/.../commands.stdout.log` に逐語保存（既存規約どおり）。

---

## 4. 新規に加える2観点（既存ハーネスに無いもの）

### 4.1 CCC = 過剰設計ガード（Reviewer 観点 + self_review rule 候補）

論文の最重要トレードオフ: リッチな全体コンテキストを与えると LLM は**遠いエッジケースへ防御的に過剰実装**し、複雑度が跳ね上がる（CCC 71.6%→46.7%）。**本ハーネスの Worker/Reviewer も同じ罠に陥りうる**（context を多く渡すほど over-engineering しやすい）。

- **Reviewer 観点**: 「タスクが要求した以上の抽象化・防御コード・将来拡張を足していないか」。preflight 4項（無関係リファクタ禁止）を**複雑度の数値で裏取り**する。
- **self_review rule 候補**（`harness.toml [worker.self_review]` で追加）:

```json
{ "rule": "no-over-engineering", "verified": true,
  "evidence": "radon cc <changed> → 新規関数の CC は元同等（最大 B ランク）。DoD にない防御分岐・抽象層を追加していないことを diff で確認" }
```

### 4.2 Global Lookup = 幻覚判定の repo 横断確認（Reviewer 観点）

論文の教訓: ファイル単位で「未定義シンボル」を幻覚と判定すると、**他モジュールで正当に定義された内部呼び出しを誤検知**する。

- **Reviewer 観点**: あるシンボルを「未定義／幻覚」と指摘する前に、**repo 全体を grep して実在を確認**する（誤 REQUEST_CHANGES を防ぐ）。逆に、変更で追加した呼び出しが builtins / 既存 repo シンボル / 宣言済みのどれにも無ければ幻覚として差し戻す。

```bash
# 指摘前の repo 横断確認（誤検知防止）
git grep -n "def <symbol>\|class <symbol>\|<symbol> =" -- '*.py'
```

- これは既存 self_review rule `all-declared-symbols-called`（宣言→呼び出し経路の確認）の**逆方向**（呼び出し→定義の実在確認）を補完する。

---

## 5. 効果測定（承認後・フェーズ着手時に実施）

| 観点 | 測定方法 | 期待 |
|---|---|---|
| 幻覚 import の検出 | §3.1 の import 実在チェックを直近 escalated タスクに遡及適用 | Worker 完了時に検出できていれば retry で自己修復可能だった件数を集計 |
| 過剰設計の検知 | radon CC を REQUEST_CHANGES 事例に適用 | 「無関係リファクタ」系の差し戻しが数値根拠付きになる |
| 誤検知の削減 | Global Lookup 確認導入前後で、取り下げられたレビュー指摘の比率 | 誤 REQUEST_CHANGES の減少 |

- いずれも**既存 `harness-logs` の集計**で測る。基盤変更・モデル変更は不要（CLAUDE.md §7 のツールセット優先の原則と整合）。

---

## 6. 根拠ログ・参照

- 論文全訳の抜粋（手法・7指標）は本セッションの会話ログに記録済み（要恒久化なら `docs/paper-translations/` に和訳を別途作成）。
- 既存の同型思想: [`agent-harness/src/verify.mjs`](../agent-harness/src/verify.mjs) 冒頭コメント（証拠ゲート・粒度＝修復可能性）。
- 既存ツール設定: [`pyproject.toml`](../pyproject.toml)（ruff lint 設定・pytest の silent-skip 防止）。
- 関連提案: [`2026-09-17-ngu-effort-reallocation.md`](2026-09-17-ngu-effort-reallocation.md)（密な評価シグナル重視の方向と整合）。

## 7. 想定される反論と回答

- **「移行専用の指標を汎用ワークに使うのは飛躍では」** → 7指標のうち DRQ/StaQ/THC/PCC/DP は移行に限らず「新規実装が実在依存に解決し・lint 通過し・型があり・契約を壊さず・ドキュメントを落とさない」という**汎用の健全性**。CMQ（加重合成）と移行特有の parent-first 順序は転用しない。
- **「self_review が重くなる」** → 既定5 rule は据え置き。追加2観点は**プロジェクト単位のオプトイン**（`harness.toml`）。重い CC 計測は radon 導入プロジェクトのみ。
- **「CodeBLEU 批判は本ハーネスに無関係では」** → 本ハーネスの等価物は「diff が通った／見た目が正しい」で完了判定する誘惑。論文はそれが壊れたコードを覆い隠す実証を与える。既存の「literal なテスト実行で確認せよ」を**数値で補強**する。
