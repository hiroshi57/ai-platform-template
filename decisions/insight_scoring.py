"""ダッシュボードの示唆スコアリング(多観点 Score をコードで合成).

working note 5.6 の適用: 観点ごとに1つの Score を聞き(同じ state に対して1回でまとめて評価)、
重みはコード側に置く。重みがコードにあるので業務ルールをレビューでき、同じモデル出力を
複数の方針(重み)で使い回せる。数値で決まる要素(空き工数・期日までの日数など)は
モデルに聞かず code_features としてコードから渡す。

プリセット:
- TASK_MATCH_DIMENSIONS: タスクマーケットの「人 × タスク」マッチング
- PRIORITY_DIMENSIONS: AI マネージャーのタスク優先度
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from core.decision import DecisionBackend, Score, evaluate


@dataclass(frozen=True)
class Dimension:
    name: str
    instructions: str
    levels: Sequence[str]     # levels[i] = 値 i のアンカー(全段階に定義する)
    weight: float

    def __post_init__(self) -> None:
        if self.weight < 0:
            raise ValueError(f"{self.name}: weight must be >= 0")
        if len(self.levels) < 2:
            raise ValueError(f"{self.name}: needs at least 2 levels")


TASK_MATCH_DIMENSIONS: Tuple[Dimension, ...] = (
    Dimension("skill_fit", "担当者のスキル・経験は、このタスクの要件にどの程度合っているか", (
        "要件に必要なスキル・経験の記載が担当者側に1つもない",
        "関連するスキルはあるが、主要な要件の半分未満しか満たさない",
        "主要な要件の大半を満たすが、一部は未経験",
        "主要な要件をすべて満たし、同種タスクの実績がある",
    ), 0.6),
    Dimension("growth_fit", "このタスクは担当者が伸ばしたいスキル・キャリア志向に沿っているか", (
        "担当者の志向と無関係",
        "志向と部分的に関係する",
        "担当者が明示した伸ばしたいスキルに直接つながる",
    ), 0.2),
)

PRIORITY_DIMENSIONS: Tuple[Dimension, ...] = (
    Dimension("impact", "このタスクが完了したときの事業・顧客への影響の大きさ", (
        "影響は社内の一部作業の効率化にとどまる",
        "1チームの目標やKPIに影響する",
        "顧客・売上・契約に直接影響する",
    ), 0.5),
    Dimension("urgency", "遅れた場合の不利益がどれだけ差し迫っているか", (
        "遅れても不利益はほぼない",
        "遅れると後続作業が詰まる",
        "遅れると顧客対応・契約・法令上の不利益が発生する",
    ), 0.3),
)


@dataclass
class ScoredItem:
    item_id: str
    composite: float                          # 0..1(重み付き平均)
    bucket: str                               # 例: hot / warm / defer / review
    dimension_scores: Dict[str, float]        # 観点ごと 0..1 に正規化
    drivers: List[str]                        # 合成スコアへの寄与が大きい順の観点名(示唆の根拠)
    uncertain: bool
    trace: Optional[Dict[str, Any]] = field(default=None, repr=False)


def _check_unit(value: float, where: str) -> float:
    v = float(value)
    if math.isnan(v) or not 0 <= v <= 1:
        raise ValueError(f"{where}: code feature must be within 0..1, got {value!r}")
    return v


def score_items(
    backend: DecisionBackend,
    items: Mapping[str, Mapping[str, Any]],
    dimensions: Sequence[Dimension],
    *,
    context: Optional[Mapping[str, Any]] = None,
    code_features: Optional[Mapping[str, Mapping[str, float]]] = None,
    code_weights: Optional[Mapping[str, float]] = None,
    buckets: Sequence[Tuple[float, str]] = ((0.70, "hot"), (0.40, "warm")),
    default_bucket: str = "defer",
    min_confidence: float = 0.50,
    uncertain_bucket: str = "review",
) -> List[ScoredItem]:
    """items を合成スコアの降順で返す.

    - code_features[item_id][name] は 0..1 の値(コードで計算済み)。重みは code_weights[name]。
    - どれかの観点の確信度が min_confidence 未満なら uncertain とし、uncertain_bucket に回す
      (自信のない高スコアを「hot」として出さない)。
    """
    if not dimensions:
        raise ValueError("dimensions is empty")
    names = [d.name for d in dimensions]
    code_weights = dict(code_weights or {})
    if len(set(names) | set(code_weights)) != len(names) + len(code_weights):
        raise ValueError("dimension and code feature names must be unique")
    if any(w < 0 for w in code_weights.values()):
        raise ValueError("code weight must be >= 0")
    total_weight = sum(d.weight for d in dimensions) + sum(code_weights.values())
    if total_weight <= 0:
        raise ValueError("total weight must be > 0")
    thresholds = sorted(buckets, key=lambda b: b[0], reverse=True)
    questions = {d.name: Score(d.instructions, list(d.levels)) for d in dimensions}

    results: List[ScoredItem] = []
    for item_id, item in items.items():
        state = {"context": dict(context or {}), "item": dict(item)}
        r = evaluate(backend, state, questions)
        scores: Dict[str, float] = {}
        contrib: Dict[str, float] = {}
        uncertain = False
        for d in dimensions:
            a = r.answers[d.name]
            scores[d.name] = a.score / (len(d.levels) - 1)
            contrib[d.name] = d.weight * scores[d.name]
            uncertain = uncertain or a.confidence < min_confidence
        feats = (code_features or {}).get(item_id, {})
        for name, w in code_weights.items():
            if name not in feats:
                raise ValueError(f"{item_id}: missing code feature {name!r}")
            scores[name] = _check_unit(feats[name], f"{item_id}.{name}")
            contrib[name] = w * scores[name]
        composite = sum(contrib.values()) / total_weight
        bucket = next((label for th, label in thresholds if composite >= th), default_bucket)
        if uncertain:
            bucket = uncertain_bucket
        drivers = sorted(contrib, key=lambda k: contrib[k], reverse=True)
        results.append(ScoredItem(item_id, composite, bucket, scores, drivers, uncertain, r.trace))
    return sorted(results, key=lambda s: s.composite, reverse=True)
