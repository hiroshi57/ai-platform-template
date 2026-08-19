const BASE = import.meta.env?.VITE_API || "http://localhost:8000";

// テナントはサーバ側が API キーから解決する。
// 旧実装は X-Tenant-Id をクライアントから送っており、任意テナントに成りすませた。
const headers = (apiKey) => ({
  "Content-Type": "application/json",
  "X-API-Key": apiKey || "",
});

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function handle(res) {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* JSON でないレスポンスはステータスのみ使う */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

export async function chat(apiKey, prompt, strategy, { signal } = {}) {
  const res = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ prompt, strategy }),
    signal,
  });
  return handle(res);
}

export async function metrics(apiKey, { signal } = {}) {
  return handle(await fetch(`${BASE}/v1/metrics`, { headers: headers(apiKey), signal }));
}

export async function budget(apiKey, budgetUsd, { signal } = {}) {
  const url = `${BASE}/v1/budget?budget_usd=${encodeURIComponent(budgetUsd)}`;
  return handle(await fetch(url, { headers: headers(apiKey), signal }));
}

export async function providers({ signal } = {}) {
  return handle(await fetch(`${BASE}/v1/providers`, { signal }));
}

/**
 * HTML レポートを取得して blob URL を返す。
 * 旧実装は window.open(`${BASE}/v1/report`) だったが、ブラウザの
 * ナビゲーションには認証ヘッダが付かないため必ず 401 になっていた。
 * 呼び出し側は使い終わったら URL.revokeObjectURL すること。
 */
export async function fetchReportUrl(apiKey, { signal } = {}) {
  const res = await fetch(`${BASE}/v1/report`, { headers: headers(apiKey), signal });
  if (!res.ok) throw new ApiError(`report failed: ${res.status}`, res.status);
  const html = await res.text();
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

export { ApiError, BASE };
