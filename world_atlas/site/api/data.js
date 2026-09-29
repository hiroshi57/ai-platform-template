// GET /api/data?f=series/pop_hist.json → 完全版のデータを、ライセンスのある人にだけ返す
// 完全版のデータは api/_paid/ にあり、静的ファイルとしては公開されない(vercel.json の includeFiles で関数にだけ同梱)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { licenseFromRequest, send } from "./_lib.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "_paid");
const ALLOWED = /^(series\/[a-z0-9_]+\.json|latest_paid\.json|exports\.json|flows\/refugees\.json|factbook_ja\.json)$/;

export default async function handler(req, res, { env = process.env, root = ROOT } = {}) {
  let lic = null;
  try { lic = licenseFromRequest(req, env); } catch { lic = null; }
  if (!lic) return send(res, 401, { error: "完全版のライセンスが必要です" });
  const f = new URL(req.url, "http://x").searchParams.get("f") || "";
  if (!ALLOWED.test(f)) return send(res, 400, { error: "ファイル名が正しくありません" });
  try {
    const body = await readFile(path.join(root, f));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // 本人の端末にだけ保存してよい(共有キャッシュには置かない)
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(body);
  } catch {
    return send(res, 404, { error: "データが見つかりません" });
  }
}
