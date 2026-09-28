// state-patch.mjs — 層4 状態パッチの検証とマージ（SKILL.state 方式）
//
// 根拠: arXiv:2608.26263（SKILL.state）。モデルは状態を丸ごと書き直さず、差分（パッチ）だけを出す。
// パッチの検証と適用はランタイム（このファイル）が決定的に行い、モデルには任せない。
//
// 論文の誤り分析（Gemma-4-31B, T=100）では、失敗の 68% が「既存キーを落とす上書き」、
// 20% が型の取り違え、12% が JSON 文法ミスだった。本モジュールはそれぞれを次で防ぐ:
//   - 上書き事故 : パッチに書かれていないキーは必ず残る（merge）。削除は null の明示のみ。
//                  merge:"append" の配列は「追加分だけ」を受け取り、既存要素を消せない。
//   - 型の取り違え: schema で型を検証し、違反したら状態を一切変えずに差し戻す（rollback）。
//   - JSON 文法  : parseStepOutput が構文エラーを retry 可能なエラーとして返す。

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Worker ループの状態スキーマ（領域ごとに1回だけ定義し、タスク間で使い回す）。
//   type      : "string" | "number" | "array" | "object" | "any"
//   nullable  : true なら null（削除）を受け付ける
//   immutable : true ならパッチで変更できない（契約由来の値）
//   merge     : "append" なら配列はパッチ値を末尾に追加（重複は除く）。既存要素は消えない
export const WORKER_STATE_SCHEMA = {
  task_id: { type: "string", immutable: true },
  status: { type: "string" },
  completed: { type: "array", merge: "append" },
  decisions: { type: "array", merge: "append" },
  artifacts: { type: "array", merge: "append" },
  open_risks: { type: "array", merge: "append" },
  // 提案B: 試した仮説と結果。再試行時に同じ修復を繰り返さないために残す
  tested_hypotheses: { type: "array", merge: "append" },
  repairs: { type: "number" },
  max_repairs: { type: "number", immutable: true },
  last_evidence: { type: "any", nullable: true },
};

function typeOk(value, type) {
  if (type === "any") return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  return typeof value === type;
}

// 値の同一性（配列 append の重複除去に使う）
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function deepMerge(base, patch) {
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isPlainObject(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

// パッチを検証して適用する。
// 戻り値: { ok: true, state } | { ok: false, state: <元の状態のまま>, errors: [...] }
// 元の state オブジェクトは変更しない（失敗時の rollback を保証するため）。
export function applyPatch(state, patch, schema = WORKER_STATE_SCHEMA) {
  const errors = [];
  if (!isPlainObject(patch)) {
    return { ok: false, state, errors: ["patch はオブジェクトである必要があります"] };
  }

  for (const [key, value] of Object.entries(patch)) {
    const rule = schema[key];
    if (!rule) {
      errors.push(`未知のキー: ${key}`);
      continue;
    }
    if (rule.immutable) {
      errors.push(`変更不可のキー: ${key}`);
      continue;
    }
    if (value === null) {
      if (!rule.nullable) errors.push(`削除できないキー: ${key}`);
      continue;
    }
    if (!typeOk(value, rule.type)) {
      errors.push(`型が不正: ${key} は ${rule.type} が必要（受け取った値: ${JSON.stringify(value)}）`);
    }
  }

  if (errors.length > 0) return { ok: false, state, errors };

  const next = structuredClone(state);
  for (const [key, value] of Object.entries(patch)) {
    const rule = schema[key];
    if (value === null) {
      delete next[key];
    } else if (rule.type === "array" && rule.merge === "append") {
      const current = Array.isArray(next[key]) ? next[key] : [];
      for (const item of value) {
        if (!current.some((c) => same(c, item))) current.push(item);
      }
      next[key] = current;
    } else if (rule.type === "object") {
      next[key] = deepMerge(next[key], value);
    } else {
      next[key] = structuredClone(value);
    }
  }
  return { ok: true, state: next };
}

// モデル出力から ```json ブロックを取り出し、{ state_patch, action } を返す。
// 推論部分（ブロックの外側）は返さない = 次のプロンプトに持ち越さない。
// 戻り値: { ok: true, state_patch, action } | { ok: false, errors: [...] }
export function parseStepOutput(text) {
  const match = /```json\s*([\s\S]*?)```/.exec(String(text));
  if (!match) return { ok: false, errors: ["```json ブロックがありません"] };

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (e) {
    return { ok: false, errors: [`JSON 構文エラー: ${e.message}`] };
  }
  if (!isPlainObject(parsed)) return { ok: false, errors: ["JSON のトップレベルはオブジェクトが必要"] };

  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== "action" || keys[1] !== "state_patch") {
    return { ok: false, errors: [`キーは state_patch と action の2つだけが必要（受け取ったキー: ${keys.join(", ")}）`] };
  }
  if (!isPlainObject(parsed.state_patch)) return { ok: false, errors: ["state_patch はオブジェクトが必要"] };
  if (typeof parsed.action !== "string") return { ok: false, errors: ["action は文字列が必要"] };

  return { ok: true, state_patch: parsed.state_patch, action: parsed.action };
}
