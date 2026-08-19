import React, { useState, useEffect, useCallback } from "react";
import Playground from "./screens/Playground.jsx";
import Observability from "./screens/Observability.jsx";
import { chat, metrics, fetchReportUrl, ApiError } from "./api.js";

// デモ用のサンプル値。旧実装はこれを初期表示していたが「サンプルである」表示が
// 無かったため、実際にバックエンドを叩いて得た数字と区別できなかった。
// isDemo フラグで常にバナー表示し、実データ取得後に false にする。
const DEMO_SUMMARY = {
  count: 4, ok_count: 4, error_count: 0, error_rate: 0,
  total_cost_usd: 0.000257, p50_latency_ms: 900, p95_latency_ms: 1300,
  p99_latency_ms: 1400, fallback_rate: 0.0,
  by_provider: {
    claude: { count: 2, cost_usd: 0.000192, input_tokens: 40, output_tokens: 30 },
    gemini: { count: 2, cost_usd: 0.000066, input_tokens: 40, output_tokens: 30 },
  },
};

const KEY_STORAGE = "ai_platform_api_key";

export default function App() {
  const [tab, setTab] = useState("play");
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || "");
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(DEMO_SUMMARY);
  const [isDemo, setIsDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // API キーは sessionStorage(タブを閉じたら消える)に置く。
  // localStorage は永続化されるため、共有端末で残り続けるリスクがある。
  useEffect(() => {
    if (apiKey) sessionStorage.setItem(KEY_STORAGE, apiKey);
    else sessionStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);

  const send = useCallback(async (prompt, strategy) => {
    if (!apiKey) {
      setError("API キーを入力してください(サーバの AI_PLATFORM_API_KEYS で設定した値)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResult(await chat(apiKey, prompt, strategy));
      setSummary(await metrics(apiKey));
      setIsDemo(false);
    } catch (e) {
      // 旧実装は alert() で握り潰していた。原因別に案内する。
      if (e instanceof ApiError && e.status === 401) setError("認証に失敗しました。API キーを確認してください。");
      else if (e instanceof ApiError && e.status === 429) setError("レート制限に達しました。しばらく待って再試行してください。");
      else if (e instanceof ApiError && e.status === 503) setError("全プロバイダが応答しません。時間をおいて再試行してください。");
      else if (e instanceof ApiError) setError(`エラー: ${e.message}`);
      else setError(`バックエンドへ接続できません(未起動 / CORS 設定を確認): ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [apiKey]);

  const openReport = useCallback(async () => {
    try {
      const url = await fetchReportUrl(apiKey);
      window.open(url, "_blank", "noopener");
      // blob URL は明示的に解放しないとタブが閉じるまでメモリに残る
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(`レポート取得に失敗: ${e.message}`);
    }
  }, [apiKey]);

  return (
    <div className="wrap">
      <h1>AI基盤テンプレート</h1>

      <div className="authbar">
        <label htmlFor="apikey">API キー</label>
        <input
          id="apikey"
          type="password"
          autoComplete="off"
          placeholder="AI_PLATFORM_API_KEYS で設定した値"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      {isDemo && (
        <div className="banner warn" role="status">
          ⚠ 表示中の観測性データは <b>サンプル値</b> です。実データではありません。
          API キーを入力して送信すると実際の値に置き換わります。
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}

      <nav>
        <button onClick={() => setTab("play")} disabled={tab === "play"}>プレイグラウンド</button>
        <button onClick={() => setTab("obs")} disabled={tab === "obs"}>観測性</button>
      </nav>

      {tab === "play"
        ? <Playground onSend={send} result={result} busy={busy} />
        : <Observability summary={summary} isDemo={isDemo} onOpenReport={openReport} />}
    </div>
  );
}
