"""最小の API キー認証. 実運用では KMS/DB 管理に差し替える前提."""
from __future__ import annotations

import hashlib
import os
from typing import Dict, Optional


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class APIKeyStore:
    """key(平文) -> tenant_id を保持。比較はハッシュで行う."""

    def __init__(self, keys: Optional[Dict[str, str]] = None) -> None:
        # {hashed_key: tenant_id}
        self._keys: Dict[str, str] = {}
        for raw, tenant in (keys or {}).items():
            self._keys[_hash(raw)] = tenant

    @classmethod
    def from_env(cls, var: str = "AI_PLATFORM_API_KEYS") -> "APIKeyStore":
        """環境変数 "key1:tenantA,key2:tenantB" 形式から読み込む."""
        raw = os.getenv(var, "").strip()
        keys: Dict[str, str] = {}
        if raw:
            for pair in raw.split(","):
                if ":" in pair:
                    k, t = pair.split(":", 1)
                    keys[k.strip()] = t.strip()
        return cls(keys)

    def add(self, raw_key: str, tenant_id: str) -> None:
        self._keys[_hash(raw_key)] = tenant_id

    def resolve_tenant(self, raw_key: Optional[str]) -> Optional[str]:
        if not raw_key:
            return None
        return self._keys.get(_hash(raw_key))

    def verify(self, raw_key: Optional[str]) -> bool:
        return self.resolve_tenant(raw_key) is not None
