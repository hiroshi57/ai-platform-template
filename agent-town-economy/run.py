"""CLI entrypoint: run a condition (or the tourism sweep), validate, report.

Examples
--------
    python run.py --condition baseline --pulses 336 --seed 1
    python run.py --condition wealth-grant --pulses 336 --seed 1      # prints MPC
    python run.py --sweep --pulses 336 --seeds 3                      # margin decomposition
    python run.py --condition baseline --pulses 336 --no-memory       # ablation arm
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analysis.metrics import (  # noqa: E402
    compute_metrics,
    margin_decomposition,
    marginal_propensity_to_consume,
)
from analysis.validate import validate  # noqa: E402
from sim.conditions import get_condition  # noqa: E402
from sim.engine import Simulation  # noqa: E402
from sim.policy import HeuristicPolicy  # noqa: E402


def run_one(condition_name, pulses, seed, memory=True, reprice=0.001, wage_raise=0.001, mpc=0.035):
    condition = get_condition(condition_name)
    policy = HeuristicPolicy(random.Random(seed + 7), reprice_prob=reprice, wage_raise_prob=wage_raise, mpc=mpc)
    sim = Simulation(condition, policy, seed=seed, memory_enabled=memory)
    return sim.run(pulses)


def _print(title, obj):
    print(f"\n== {title} ==")
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description="LLM-agent town economy (repro of arXiv:2609.11108)")
    ap.add_argument("--condition", default="baseline")
    ap.add_argument("--pulses", type=int, default=336, help="336 = 2 simulated weeks")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--seeds", type=int, default=3, help="number of seeds for --sweep")
    ap.add_argument("--no-memory", action="store_true", help="run the memory-ablation arm")
    ap.add_argument("--reprice-prob", type=float, default=0.001)
    ap.add_argument("--wage-raise-prob", type=float, default=0.001)
    ap.add_argument("--mpc", type=float, default=0.035)
    ap.add_argument("--sweep", action="store_true", help="tourism low/high sweep + margin decomposition")
    args = ap.parse_args()

    if args.sweep:
        lows, highs = [], []
        for s in range(args.seeds):
            lows.append(run_one("tourism-low", args.pulses, s, mpc=args.mpc))
            highs.append(run_one("tourism-high", args.pulses, s, mpc=args.mpc))
        _print("validation (low seed 0)", validate(lows[0]))
        _print("metrics low (seed 0)", compute_metrics(lows[0]))
        _print("metrics high (seed 0)", compute_metrics(highs[0]))
        _print("margin decomposition (seed 0)", margin_decomposition(lows[0], highs[0]))
        return 0

    result = run_one(
        args.condition, args.pulses, args.seed,
        memory=not args.no_memory,
        reprice=args.reprice_prob, wage_raise=args.wage_raise_prob, mpc=args.mpc,
    )
    _print("validation", validate(result))
    _print("metrics", compute_metrics(result))
    mpc = marginal_propensity_to_consume(result)
    if mpc is not None:
        _print("marginal propensity to consume", mpc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
