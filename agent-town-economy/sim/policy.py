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

`LLMPolicy` connects a real model (see `sim.llm_backend`). It builds a compact
observation, calls the backend, parses+validates the returned tool name, and
falls back to the heuristic on any malformed output -- so a bad generation is
forfeited, never fatal (paper section 5).
"""
from __future__ import annotations

import json
import random
import re
from typing import Callable, Dict, Optional, Tuple

from . import money
from .agents import Agent
from .tools import TOOL_CATEGORIES

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

    def choose(self, agent: Agent, sim=None) -> Action:
        r = self.rng.random()
        if agent.owns_business is not None:
            if r < self.reprice_prob:
                return ("set_price", {})
            if r < self.reprice_prob + self.wage_raise_prob:
                return ("set_wage", {})
        if self.rng.random() < self.mpc:
            return ("buy_food", {})
        roll = self.rng.random()
        if roll < 0.30:
            return ("start_shift", {})
        if roll < 0.75:
            return ("invite_to_talk", {})
        if roll < 0.85:
            return ("write_memory", {"text": "pulse-note"})
        if roll < 0.92:
            return ("reflect", {})
        return ("observe_place", {})


def _build_observation(agent: Agent, sim) -> str:
    wallet = bank = 0
    nearby = 0
    if sim is not None:
        wallet = sim.ledger.balance(money.agent_wallet(agent.agent_id))
        bank = sim.ledger.balance(money.agent_bank(agent.agent_id))
        nearby = len(sim.world.places_within(agent.pos))
    tools = ", ".join(sorted(TOOL_CATEGORIES))
    return (
        f"pulse={getattr(sim, 'pulse', 0)} agent={agent.agent_id} "
        f"wallet={wallet} bank={bank} owns_business={agent.owns_business is not None} "
        f"on_shift={agent.on_shift_at is not None} in_conversations={agent.in_conversations} "
        f"places_in_view={nearby}\n"
        f"Available tools: {tools}\n"
        "Pick one tool that best advances your economic interest."
    )


def _parse_tool_name(text: str) -> Optional[str]:
    text = (text or "").strip()
    # Try JSON first: {"tool": "..."}
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            name = obj["tool"].strip()
            if name in TOOL_CATEGORIES:
                return name
    except (json.JSONDecodeError, ValueError):
        pass
    # Fall back to the first known tool token appearing in the text.
    for token in re.findall(r"[a-z_]+", text):
        if token in TOOL_CATEGORIES:
            return token
    return None


class LLMPolicy:
    """Adapter around an external model. `backend(prompt) -> raw_text`."""

    def __init__(
        self,
        backend: Callable[[str], str],
        fallback: Optional[HeuristicPolicy] = None,
    ) -> None:
        self.backend = backend
        self.fallback = fallback
        self.malformed = 0  # forfeited generations, mirroring the paper's counter

    def choose(self, agent: Agent, sim=None) -> Action:
        prompt = _build_observation(agent, sim)
        name = None
        try:
            name = _parse_tool_name(self.backend(prompt))
        except Exception:
            name = None
        if name is None:
            self.malformed += 1
            if self.fallback is not None:
                return self.fallback.choose(agent, sim)
            return ("observe_place", {})
        kwargs: Dict[str, object] = {"text": "pulse-note"} if name == "write_memory" else {}
        return (name, kwargs)
