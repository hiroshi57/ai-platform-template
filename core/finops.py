"""FinOps for LLM(差別化の核). LLM利用コストを「読める・守れる」化する.

汎用LLMラッパーが出せない堀:
  1. 月次コスト予測: 現時点の消費ペースから着地見込みを外挿
  2. 予算アラート: 着地見込みが予算を超える場合に警告(閾値段階)
  3. 予算内ルーティング: 残予算に応じて cost 戦略へ自動降格し、超過を防ぐ
  4. コスト異常検知: 単価×件数の急変を検出
すべて標準ライブラリのみ。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .llm_router import RoutingStrategy


@dataclass
class BudgetStatus:
    spent_usd: float
    budget_usd: float
    day_of_month: int
    days_in_month: int
    projected_usd: float          # 月末着地見込み
    over_budget: bool
    alert_level: str              # ok / warn / critical
    remaining_usd: float

    def as_dict(self):
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def project_month_end(spent_usd: float, day_of_month: int, days_in_month: int = 30) -> float:
    """日割りペースで月末コストを外挿."""
    if day_of_month <= 0:
        return 0.0
    daily = spent_usd / day_of_month
    return daily * days_in_month


class BudgetGuard:
    def __init__(self, budget_usd: float, warn_ratio: float = 0.8, critical_ratio: float = 1.0) -> None:
        self.budget_usd = budget_usd
        self.warn_ratio = warn_ratio
        self.critical_ratio = critical_ratio

    def status(self, spent_usd: float, day_of_month: int, days_in_month: int = 30) -> BudgetStatus:
        projected = project_month_end(spent_usd, day_of_month, days_in_month)
        ratio = (projected / self.budget_usd) if self.budget_usd > 0 else 0.0
        level = "ok"
        if ratio >= self.critical_ratio:
            level = "critical"
        elif ratio >= self.warn_ratio:
            level = "warn"
        return BudgetStatus(
            spent_usd=spent_usd, budget_usd=self.budget_usd, day_of_month=day_of_month,
            days_in_month=days_in_month, projected_usd=projected,
            over_budget=projected > self.budget_usd, alert_level=level,
            remaining_usd=max(0.0, self.budget_usd - spent_usd))

    def choose_strategy(self, spent_usd: float, day_of_month: int,
                        requested: RoutingStrategy, days_in_month: int = 30) -> RoutingStrategy:
        """予算内ルーティング: 着地見込みが予算超過なら cost 戦略へ自動降格."""
        st = self.status(spent_usd, day_of_month, days_in_month)
        if st.alert_level == "critical":
            return RoutingStrategy.COST      # 超過見込み -> 最安固定で守る
        return requested


@dataclass
class CostAnomaly:
    is_anomaly: bool
    current: float
    baseline: float
    ratio: float
    note: str = ""


def detect_cost_anomaly(recent_daily: List[float], today: float, threshold: float = 2.0) -> CostAnomaly:
    """直近平均に対し today のコストが threshold 倍以上なら異常."""
    base = sum(recent_daily) / len(recent_daily) if recent_daily else 0.0
    ratio = (today / base) if base > 0 else 0.0
    is_anom = base > 0 and ratio >= threshold
    return CostAnomaly(is_anomaly=is_anom, current=today, baseline=round(base, 6),
                       ratio=round(ratio, 2),
                       note=f"直近平均の{ratio:.1f}倍" if is_anom else "正常範囲")
