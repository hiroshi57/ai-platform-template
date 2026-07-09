"""API キー無しで動く CLI デモ. `python -m app_template.demo` で実行."""
from __future__ import annotations

import json

from core import LLMRouter, RoutingStrategy


def main() -> None:
    router = LLMRouter()  # 既定の mock プロバイダ(claude/openai/gemini)
    prompt = "社内規程のうち経費精算の締め日を教えて"

    print("=== 戦略別ルーティング(APIキー不要) ===")
    for strategy in RoutingStrategy:
        c = router.route(prompt, strategy=strategy)
        print(f"[{strategy.value:8}] -> {c.provider:7} model={c.model:16} "
              f"cost=${c.cost_usd:.6f} latency={c.latency_ms:.0f}ms")

    print("\n=== 観測性サマリ ===")
    print(json.dumps(router.metrics.summary(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
