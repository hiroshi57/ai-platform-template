"""スキル提案ルーター(Rank Wide, Read Narrow).

working note 8.1(Hermes 182 スキル)のやり方:

1. 1 回目: スキル一覧(名前 + 要約)全件を安くランクし、同時に「このターンにスキルが要るか」を聞く。
2. 2 回目: 上位 k 件だけ詳細を読ませ、各スキルが合うかを **独立した Noul** で聞く。全部却下してよい。

出力は命令ではなく **提案**(shortlist + 推奨1件 or なし)。エージェント自身の判断を残す。
提案が、もともと正しく処理できていたリクエストを壊すことがある(note では 315 件中 7 件)ため。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from core.decision import Choice, DecisionBackend, Noul, evaluate

NO_SKILL = "no_skill"


@dataclass(frozen=True)
class Skill:
    id: str
    summary: str
    detail: str = ""


@dataclass
class SkillSuggestion:
    skill_id: Optional[str]          # None = どのスキルも読み込まない
    shortlist: List[str]
    reason: str
    fit: Dict[str, float] = field(default_factory=dict)
    traces: List[Dict[str, Any]] = field(default_factory=list)


_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)


def load_skills_from_dir(root: Path) -> List[Skill]:
    """``<root>/<skill>/SKILL.md`` の frontmatter(name/description)からカタログを作る.

    Claude Code / Hermes 形式の SKILL.md を想定。frontmatter が無いファイルは読み飛ばす。
    """
    skills: List[Skill] = []
    for path in sorted(Path(root).glob("*/SKILL.md")):
        m = _FRONTMATTER.match(path.read_text(encoding="utf-8"))
        if not m:
            continue
        meta: Dict[str, str] = {}
        for line in m.group(1).splitlines():
            if ":" in line and not line.startswith((" ", "\t")):
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip("'\"")
        name = meta.get("name") or path.parent.name
        summary = meta.get("description", "")
        if summary:
            skills.append(Skill(id=name, summary=summary, detail=m.group(2).strip()))
    return skills


class SkillRouter:
    def __init__(
        self,
        backend: DecisionBackend,
        skills: Sequence[Skill],
        *,
        shortlist_size: int = 3,
        need_threshold: float = 0.5,
        fit_threshold: float = 0.6,
        detail_chars: int = 1500,
    ) -> None:
        if not skills:
            raise ValueError("skills is empty")
        ids = [s.id for s in skills]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate skill id")
        if NO_SKILL in ids:
            raise ValueError(f"skill id {NO_SKILL!r} is reserved")
        if shortlist_size < 1:
            raise ValueError("shortlist_size must be >= 1")
        self.backend = backend
        self.skills = {s.id: s for s in skills}
        self.shortlist_size = shortlist_size
        self.need_threshold = need_threshold
        self.fit_threshold = fit_threshold
        self.detail_chars = detail_chars

    def suggest(self, turn: str, *, available: Optional[Sequence[str]] = None) -> SkillSuggestion:
        """available を渡すと、いま使えるスキルだけを候補にする(無効化済みスキルを見せない)."""
        pool = [self.skills[i] for i in (available or self.skills) if i in self.skills]
        if not pool:
            return SkillSuggestion(None, [], "no available skill")

        # --- 1 回目: 全件ランク + スキル要否 ---
        criteria = {s.id: s.summary for s in pool}
        criteria[NO_SKILL] = "The turn can be answered directly without loading any skill."
        r1 = evaluate(self.backend, {"user_turn": turn}, {
            "rank": Choice("Which skill best fits this user turn?", criteria),
            "needs_skill": Noul("This user turn requires loading a specialised skill."),
        })
        rank = r1.answers["rank"]
        needs = r1.answers["needs_skill"].noul
        ordered = sorted((sid for sid in rank.probabilities if sid != NO_SKILL),
                         key=lambda sid: rank.probabilities[sid], reverse=True)
        shortlist = ordered[: self.shortlist_size]
        if needs < self.need_threshold or rank.choice == NO_SKILL:
            return SkillSuggestion(None, shortlist, f"no skill needed (needs_skill={needs:.2f})",
                                   traces=[r1.trace])

        # --- 2 回目: 上位だけ詳細を読み、独立 Noul で適合を判定 ---
        state = {
            "user_turn": turn,
            "candidates": {sid: {"summary": self.skills[sid].summary,
                                 "detail": self.skills[sid].detail[: self.detail_chars]}
                           for sid in shortlist},
        }
        questions = {f"fits:{sid}": Noul(f"Skill '{sid}' is the right procedure for this user turn.")
                     for sid in shortlist}
        r2 = evaluate(self.backend, state, questions)
        fit = {sid: r2.answers[f"fits:{sid}"].noul for sid in shortlist}
        best = max(shortlist, key=lambda sid: fit[sid])
        if fit[best] < self.fit_threshold:
            return SkillSuggestion(None, shortlist,
                                   f"all candidates rejected (best {best}={fit[best]:.2f})",
                                   fit, [r1.trace, r2.trace])
        return SkillSuggestion(best, shortlist, f"{best} fit={fit[best]:.2f}", fit, [r1.trace, r2.trace])
