"""実プロバイダ切替(Claude/GPT/Gemini). SDK は遅延 import.

APIキーが無い / SDK 未インストールの場合は MockProvider へ自動フォールバックするため、
clone 直後(キー無し)でも動作し、キーを設定すれば実 API に切り替わる。
"""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

from .providers import (
    BaseProvider,
    Completion,
    MockProvider,
    ProviderSpec,
    _estimate_tokens,
)

# 各プロバイダの spec とキー環境変数名
PROVIDER_REGISTRY = {
    "claude": {
        "spec": ProviderSpec("claude", "claude-3-5-sonnet", 0.003, 0.015, 900, 0.93),
        "key_env": "ANTHROPIC_API_KEY",
    },
    "openai": {
        "spec": ProviderSpec("openai", "gpt-4o", 0.005, 0.015, 1100, 0.92),
        "key_env": "OPENAI_API_KEY",
    },
    "gemini": {
        "spec": ProviderSpec("gemini", "gemini-1.5-pro", 0.00125, 0.005, 1300, 0.88),
        "key_env": "GOOGLE_API_KEY",
    },
}


class AnthropicProvider(BaseProvider):
    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:  # pragma: no cover
        from anthropic import Anthropic  # 遅延 import
        client = Anthropic()
        t0 = time.time()
        resp = client.messages.create(
            model=self.spec.model, max_tokens=max_output_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        latency = (time.time() - t0) * 1000
        it = getattr(resp.usage, "input_tokens", _estimate_tokens(prompt))
        ot = getattr(resp.usage, "output_tokens", _estimate_tokens(text))
        return Completion(text, self.spec.name, self.spec.model, it, ot, latency,
                          self.spec.estimated_cost(it, ot))


class OpenAIProvider(BaseProvider):
    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:  # pragma: no cover
        from openai import OpenAI
        client = OpenAI()
        t0 = time.time()
        resp = client.chat.completions.create(
            model=self.spec.model, max_tokens=max_output_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.choices[0].message.content or ""
        latency = (time.time() - t0) * 1000
        it = getattr(resp.usage, "prompt_tokens", _estimate_tokens(prompt))
        ot = getattr(resp.usage, "completion_tokens", _estimate_tokens(text))
        return Completion(text, self.spec.name, self.spec.model, it, ot, latency,
                          self.spec.estimated_cost(it, ot))


class GeminiProvider(BaseProvider):
    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:  # pragma: no cover
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
        model = genai.GenerativeModel(self.spec.model)
        t0 = time.time()
        resp = model.generate_content(prompt)
        text = resp.text or ""
        latency = (time.time() - t0) * 1000
        it, ot = _estimate_tokens(prompt), _estimate_tokens(text)
        return Completion(text, self.spec.name, self.spec.model, it, ot, latency,
                          self.spec.estimated_cost(it, ot))


_REAL_CLASSES = {"claude": AnthropicProvider, "openai": OpenAIProvider, "gemini": GeminiProvider}


def build_provider(name: str) -> BaseProvider:
    """1プロバイダを構築. キーが無ければ MockProvider を返す."""
    entry = PROVIDER_REGISTRY[name]
    spec = entry["spec"]
    if os.getenv(entry["key_env"]):
        return _REAL_CLASSES[name](spec)   # 実API
    return MockProvider(spec)              # フォールバック(キー無し)


def build_providers(names: Optional[List[str]] = None) -> Dict[str, BaseProvider]:
    names = names or list(PROVIDER_REGISTRY.keys())
    return {n: build_provider(n) for n in names if n in PROVIDER_REGISTRY}


def provider_mode(name: str) -> str:
    """"real"(キーあり) / "mock"(キー無し) を返す(可観測性・デバッグ用)."""
    return "real" if os.getenv(PROVIDER_REGISTRY[name]["key_env"]) else "mock"
