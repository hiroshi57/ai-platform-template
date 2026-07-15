const BASE = import.meta.env?.VITE_API || "http://localhost:8000";
const h = (t) => ({ "Content-Type": "application/json", "X-Tenant-Id": t });

export async function chat(t, prompt, strategy) {
  return (await fetch(`${BASE}/v1/chat`, { method: "POST", headers: h(t), body: JSON.stringify({ prompt, strategy }) })).json();
}
export async function metrics(t) {
  return (await fetch(`${BASE}/v1/metrics`, { headers: h(t) })).json();
}
export function reportUrl() { return `${BASE}/v1/report`; }
