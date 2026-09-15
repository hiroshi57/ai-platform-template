"""The spatial world: places, priced menus, and a visibility radius.

Modelled on the paper's Lakeside, Pokhara setting (2609.11108, section 3):
762 registered places across seven categories, most carrying priced menus
(the paper reports 735 priced places / 3,981 items). Real OpenStreetMap
footprints are approximated here by coordinates on a metric grid; a real OSM
layout can be plugged in by replacing :func:`build_registry`.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

CATEGORIES = [
    "restaurant",
    "cafe",
    "shop",
    "guesthouse",
    "bar",
    "bakery",
    "streetfood",
]

# Paper-reported registry scale.
N_PLACES = 762
N_PRICED_PLACES = 735
TARGET_MENU_ITEMS = 3981

TOWN_SIZE_M = 2000.0  # ~2km square, Lakeside strip scale
VISIBILITY_RADIUS_M = 80.0


@dataclass
class MenuItem:
    name: str
    price: int  # integer NPR
    reprices: int = 0


@dataclass
class Place:
    place_id: int
    category: str
    x: float
    y: float
    menu: List[MenuItem] = field(default_factory=list)
    owner_id: Optional[int] = None  # agent that owns/prices this business
    wage_per_shift: int = 0
    revenue: int = 0  # cumulative NPR taken in (for margin decomposition)
    n_transactions: int = 0

    @property
    def priced(self) -> bool:
        return len(self.menu) > 0

    def cheapest(self) -> Optional[MenuItem]:
        return min(self.menu, key=lambda m: m.price) if self.menu else None


def _distance(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


class World:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.places: Dict[int, Place] = {}
        self._build_registry()

    def _build_registry(self) -> None:
        # Distribute the fixed item budget across priced places.
        priced_ids = set(self.rng.sample(range(N_PLACES), N_PRICED_PLACES))
        items_left = TARGET_MENU_ITEMS
        for pid in range(N_PLACES):
            cat = self.rng.choice(CATEGORIES)
            place = Place(
                place_id=pid,
                category=cat,
                x=self.rng.uniform(0, TOWN_SIZE_M),
                y=self.rng.uniform(0, TOWN_SIZE_M),
            )
            if pid in priced_ids:
                remaining_places = N_PRICED_PLACES - len([1 for p in self.places.values() if p.priced])
                # aim for the item total; last place absorbs the remainder
                if pid == max(priced_ids):
                    n_items = max(1, items_left)
                else:
                    avg = max(1, items_left // max(1, remaining_places))
                    n_items = max(1, min(items_left, self.rng.randint(1, 2 * avg)))
                items_left -= n_items
                base = self.rng.randint(80, 600)
                place.menu = [
                    MenuItem(name=f"item_{pid}_{i}", price=base + self.rng.randint(-40, 300))
                    for i in range(n_items)
                ]
                place.wage_per_shift = self.rng.randint(300, 900)
            self.places[pid] = place

    def total_menu_items(self) -> int:
        return sum(len(p.menu) for p in self.places.values())

    def priced_places(self) -> List[Place]:
        return [p for p in self.places.values() if p.priced]

    def places_within(self, pos: Tuple[float, float], radius: float = VISIBILITY_RADIUS_M) -> List[Place]:
        return [p for p in self.places.values() if _distance(pos, (p.x, p.y)) <= radius]

    def nearest_priced(self, pos: Tuple[float, float]) -> Optional[Place]:
        priced = self.priced_places()
        if not priced:
            return None
        return min(priced, key=lambda p: _distance(pos, (p.x, p.y)))
