"""Decision policies.

`HeuristicPolicy` is the default so the platform runs end-to-end with no API
keys. Its three exposed knobs correspond directly to the paper's headline
mechanisms, so you can dial them and watch the metrics move:

    reprice_prob    per-activation chance an owner reprices  (paper: ~0.3% of
                    items ever repriced -> keep this tiny)
    wage_raise_prob per-activation chance an owner raises the wage (paper:
                    wages flat under a 12x demand swing -> keep this tiny)
    mpc             marginal propensity to consume out of wallet (paper: 3-4%,
                    vs 20-50% for human households -> the hoarding result)

`LLMPolicy` is a thin pluggable adapter: pass any `callable(prompt:str)->str`
returning a tool name, and you can test whether a real model breaks the
transmission failure the heuristic reproduces by construction.
"""
from __future__ import annotations

import random
from typing import Callable, Dict, Optional, Tuple

from .agents import Agent

Action = Tuple[str, Dict[str, object]]


class HeuristicPolicy:
    def __init__(
        self,
        rng: random.Random,
        reprice_prob: float = 0.001,
        wage_raise_prob: float = 0.001,
        mpc: float = 0.035,
    ) -> None:
        self.rng = rng
        self.reprice_prob = reprice_prob
        self.wage_raise_prob = wage_raise_prob
        self.mpc = mpc

    def choose(self, agent: Agent) -> Action:
        r = self.rng.random()

        # Owners very rarely exercise the price/wage levers (sections 6, 9).
        if agent.owns_business is not None:
            if r < self.reprice_prob:
                return ("set_price", {})
            if r < self.reprice_prob + self.wage_raise_prob:
                return ("set_wage", {})

        # Spend out of wallet only at the (low) marginal propensity to consume.
        if self.rng.random() < self.mpc:
            return ("buy_food", {})

        # Otherwise: work, socialise (mostly failing on the cap), or curate memory.
        roll = self.rng.random()
        if roll < 0.30:
            return ("start_shift", {})
        if roll < 0.75:
            # Heavy social calling -> reproduces the 94-97% invite failure rate.
            return ("invite_to_talk", {})
        if roll < 0.85:
            return ("write_memory", {"text": f"pulse-note"})
        if roll < 0.92:
            return ("reflect", {})
        return ("observe_place", {})


class LLMPolicy:
    """Adapter around an external model. `backend(prompt) -> tool_name`."""

    def __init__(self, backend: Callable[[str], str], fallback: Optional[HeuristicPolicy] = None) -> None:
        self.backend = backend
        self.fallback = fallback

    def choose(self, agent: Agent) -> Action:
        prompt = (
            f"You are agent {agent.agent_id}. owns_business={agent.owns_business is not None}, "
            f"on_shift={agent.on_shift_at is not None}. Choose one tool name."
        )
        try:
            name = self.backend(prompt).strip()
        except Exception:
            name = ""
        if not name and self.fallback is not None:
            return self.fallback.choose(agent)
        return (name or "observe_place", {})
