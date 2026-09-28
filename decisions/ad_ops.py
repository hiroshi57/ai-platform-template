"""広告運用の判断(検索語句の除外候補出し・広告文チェック).

working note 8.3(2段階検索)と 10.1(計算はコード)の適用:

- 1 段目(コード・決定的): 既存の除外語・指名語・データ不足・CV 実績ありを先に振り分ける。
  CPA・無駄コスト・文字数などの計算はすべてコードで行う。
- 2 段目(判断モデル): 残った語句だけ、検索意図(Choice)と商材との関連(Noul)を判定する。

このモジュールは **提案を返すだけ** で、入稿・除外登録は行わない。
DI-MCP の入稿系ツールに渡す場合も、必ず人間の確認を経ること。
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from core.decision import Choice, DecisionBackend, Noul, evaluate

# --- 検索語句の除外候補 ----------------------------------------------------------
INTENT_CRITERIA: Dict[str, str] = {
    "buyer": "広告している商材の購入・申込・資料請求・問い合わせを検討している検索",
    "researcher": "商材カテゴリについて比較・情報収集している検索(将来の顧客になり得る)",
    "competitor": "競合他社の社名・サービス名を探している検索",
    "job_seeker": "求人・採用・アルバイト・転職の情報を探している検索",
    "unrelated": "広告している商材と無関係な意味・用途の検索",
}
NEGATIVE_INTENTS = frozenset({"job_seeker", "unrelated"})


@dataclass(frozen=True)
class SearchTerm:
    term: str
    impressions: int
    clicks: int
    cost: float
    conversions: float

    def __post_init__(self) -> None:
        if min(self.impressions, self.clicks) < 0 or self.cost < 0 or self.conversions < 0:
            raise ValueError(f"negative metric in search term {self.term!r}")


@dataclass(frozen=True)
class AdvertiserContext:
    offering: str                              # 何を売っているか(判断の根拠になる唯一の商材説明)
    target: str = ""                           # 想定顧客
    brand_terms: Sequence[str] = ()
    existing_negatives: Sequence[str] = ()


@dataclass
class TermDecision:
    term: str
    action: str        # propose_negative | keep | human_review | insufficient_data | already_negative
    reason: str
    wasted_cost: float
    cpa: Optional[float]
    intent: Optional[str] = None
    intent_confidence: Optional[float] = None
    relevance: Optional[float] = None
    trace: Optional[Dict[str, Any]] = None


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower().strip()


def triage_search_terms(
    backend: DecisionBackend,
    terms: Sequence[SearchTerm],
    ctx: AdvertiserContext,
    *,
    min_clicks: int = 3,
    negative_confidence: float = 0.80,
    max_relevance_for_negative: float = 0.30,
    min_relevance_for_keep: float = 0.50,
) -> List[TermDecision]:
    """除外候補 → 保留 → その他 の順、同じ区分内は無駄コストの大きい順で返す."""
    negatives = [_norm(n) for n in ctx.existing_negatives if n.strip()]
    brands = [_norm(b) for b in ctx.brand_terms if b.strip()]
    out: List[TermDecision] = []
    for t in terms:
        norm = _norm(t.term)
        wasted = t.cost if t.conversions == 0 else 0.0
        cpa = t.cost / t.conversions if t.conversions > 0 else None
        base = {"term": t.term, "wasted_cost": wasted, "cpa": cpa}

        # 1 段目: コードで決まるものはモデルに聞かない
        if any(n in norm for n in negatives):
            out.append(TermDecision(action="already_negative", reason="既存の除外語に一致", **base))
            continue
        if any(b in norm for b in brands):
            out.append(TermDecision(action="keep", reason="指名語を含む", **base))
            continue
        if t.conversions > 0:
            out.append(TermDecision(action="keep", reason="CV 実績あり", **base))
            continue
        if t.clicks < min_clicks:
            out.append(TermDecision(action="insufficient_data",
                                    reason=f"クリック {t.clicks} < {min_clicks}", **base))
            continue

        # 2 段目: 意図と関連性を独立に判定(1 回の呼び出し)
        r = evaluate(backend, {"offering": ctx.offering, "target": ctx.target, "search_term": t.term}, {
            "intent": Choice("この検索語句の検索者の意図はどれか", INTENT_CRITERIA),
            "relevant": Noul("この検索語句の検索者は、広告している商材の見込み顧客である"),
        })
        intent = r.answers["intent"]
        relevance = r.answers["relevant"].noul
        judged = dict(base, intent=intent.choice, intent_confidence=intent.confidence,
                      relevance=relevance, trace=r.trace)
        if (intent.choice in NEGATIVE_INTENTS and intent.confidence >= negative_confidence
                and relevance <= max_relevance_for_negative):
            out.append(TermDecision(action="propose_negative",
                                    reason=f"意図={intent.choice} 関連={relevance:.2f}", **judged))
        elif intent.choice == "competitor":
            out.append(TermDecision(action="human_review", reason="競合語句は事業判断", **judged))
        elif intent.choice not in NEGATIVE_INTENTS and relevance >= min_relevance_for_keep:
            out.append(TermDecision(action="keep", reason=f"関連={relevance:.2f}", **judged))
        else:
            out.append(TermDecision(action="human_review",
                                    reason=f"確信不足 意図={intent.choice}({intent.confidence:.2f}) "
                                           f"関連={relevance:.2f}", **judged))

    order = {"propose_negative": 0, "human_review": 1}
    return sorted(out, key=lambda d: (order.get(d.action, 2), -d.wasted_cost))


# --- 広告文チェック ---------------------------------------------------------------
DEFAULT_COPY_RULES: Dict[str, str] = {
    "unsupported_superlative": (
        "「No.1」「最高」「業界初」などの最上級表現を、根拠(調査名・時期)の記載なしに使っている"),
    "guaranteed_effect": "「必ず」「絶対」「100%」など、効果や結果を断定・保証している",
    "misleading_price": "「無料」「最安」「0円」などの価格表現で、条件や対象を明示していない",
}


def display_width(text: str) -> int:
    """全角=2・半角=1 で数える(Google / Yahoo! 広告の文字数制限の数え方)."""
    return sum(2 if unicodedata.east_asian_width(c) in ("F", "W") else 1
               for c in unicodedata.normalize("NFC", text))


@dataclass
class CopyCheck:
    text: str
    status: str                     # ok | needs_fix | human_review
    width: int
    max_width: int
    violations: List[str] = field(default_factory=list)
    rule_probabilities: Dict[str, float] = field(default_factory=dict)
    trace: Optional[Dict[str, Any]] = None


def check_ad_copy(
    backend: DecisionBackend,
    text: str,
    *,
    max_width: int,
    rules: Optional[Mapping[str, str]] = None,
    flag_threshold: float = 0.70,
    review_threshold: float = 0.40,
) -> CopyCheck:
    """文字数はコード、表現リスクは規則ごとの独立 Noul で判定する(1 回の呼び出し)."""
    if not 0 <= review_threshold <= flag_threshold <= 1:
        raise ValueError("require 0 <= review_threshold <= flag_threshold <= 1")
    rules = dict(rules or DEFAULT_COPY_RULES)
    width = display_width(text)
    violations: List[str] = []
    if width > max_width:
        violations.append(f"length: {width} > {max_width}")

    r = evaluate(backend, {"ad_copy": text}, {rid: Noul(desc) for rid, desc in rules.items()})
    probs = {rid: r.answers[rid].noul for rid in rules}
    violations += [rid for rid, p in probs.items() if p >= flag_threshold]
    borderline = [rid for rid, p in probs.items() if review_threshold <= p < flag_threshold]
    status = "needs_fix" if violations else ("human_review" if borderline else "ok")
    return CopyCheck(text, status, width, max_width, violations, probs, r.trace)
