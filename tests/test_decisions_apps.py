"""decisions パッケージ(スキル提案・広告運用・示唆スコア)の検証."""
import pytest

from core.decision import Choice, DecisionBackend, MockDecisionBackend, Score
from decisions.ad_ops import (
    AdvertiserContext,
    SearchTerm,
    check_ad_copy,
    display_width,
    triage_search_terms,
)
from decisions.insight_scoring import PRIORITY_DIMENSIONS, TASK_MATCH_DIMENSIONS, Dimension, score_items
from decisions.skill_router import NO_SKILL, Skill, SkillRouter, load_skills_from_dir


class FnBackend(DecisionBackend):
    """(state, qid, question) -> 生の答え を返す関数でテスト用の判断を差し込む."""

    name = "fn"

    def __init__(self, fn):
        self.fn = fn
        self.calls = []

    def evaluate(self, state, questions):
        self.calls.append((state, dict(questions)))
        return {qid: self.fn(state, qid, q) for qid, q in questions.items()}


def one_hot(q: Choice, winner: str, p: float = 0.9):
    rest = (1 - p) / (len(q.criteria) - 1)
    return {"probabilities": {o: (p if o == winner else rest) for o in q.criteria}}


# --- スキル提案 ---------------------------------------------------------------
SKILLS = [
    Skill("pdf", "PDF を読む・変換する", "pdftotext を使う手順"),
    Skill("deploy", "Vercel にデプロイする", "vercel コマンドの手順"),
    Skill("sql", "SQL を書く", "クエリ作成の手順"),
    Skill("mail", "メールを下書きする", "Gmail 下書きの手順"),
]


def _skill_backend(rank_probs, needs, fits):
    def fn(state, qid, q):
        if qid == "rank":
            return {"probabilities": rank_probs}
        if qid == "needs_skill":
            return {"noul": needs}
        return {"noul": fits[qid.split(":", 1)[1]]}
    return FnBackend(fn)


def test_skill_router_two_stage_reads_only_shortlist():
    b = _skill_backend({"pdf": 0.5, "sql": 0.3, "mail": 0.15, "deploy": 0.05, NO_SKILL: 0.0},
                       needs=0.9, fits={"pdf": 0.8, "sql": 0.2, "mail": 0.1})
    s = SkillRouter(b, SKILLS, shortlist_size=3).suggest("この PDF を要約して")
    assert s.skill_id == "pdf"
    assert s.shortlist == ["pdf", "sql", "mail"]
    stage2_state = b.calls[1][0]
    assert set(stage2_state["candidates"]) == {"pdf", "sql", "mail"}   # deploy の詳細は読まない
    assert len(s.traces) == 2


def test_skill_router_skips_when_no_skill_needed():
    b = _skill_backend({"pdf": 0.6, NO_SKILL: 0.4}, needs=0.2, fits={})
    s = SkillRouter(b, SKILLS).suggest("こんにちは")
    assert s.skill_id is None and len(b.calls) == 1


def test_skill_router_can_reject_all_candidates():
    b = _skill_backend({"pdf": 0.4, "sql": 0.3, "mail": 0.2, "deploy": 0.1}, needs=0.9,
                       fits={"pdf": 0.3, "sql": 0.2, "mail": 0.1})
    s = SkillRouter(b, SKILLS).suggest("曖昧な依頼")
    assert s.skill_id is None and "rejected" in s.reason


def test_skill_router_hides_unavailable_skills():
    b = _skill_backend({"deploy": 1.0}, needs=0.9, fits={"deploy": 0.9, "sql": 0.1})
    SkillRouter(b, SKILLS).suggest("デプロイして", available=["deploy", "sql"])
    offered = b.calls[0][1]["rank"].criteria
    assert set(offered) == {"deploy", "sql", NO_SKILL}


def test_skill_router_rejects_reserved_or_duplicate_ids():
    with pytest.raises(ValueError):
        SkillRouter(MockDecisionBackend(), [Skill(NO_SKILL, "x")])
    with pytest.raises(ValueError):
        SkillRouter(MockDecisionBackend(), [Skill("a", "x"), Skill("a", "y")])


def test_load_skills_from_dir(tmp_path):
    (tmp_path / "pdf").mkdir()
    (tmp_path / "pdf" / "SKILL.md").write_text(
        "---\nname: pdf-reader\ndescription: 'Read PDF files'\n---\n# Steps\nuse pdftotext\n",
        encoding="utf-8")
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "SKILL.md").write_text("no frontmatter", encoding="utf-8")
    skills = load_skills_from_dir(tmp_path)
    assert [(s.id, s.summary) for s in skills] == [("pdf-reader", "Read PDF files")]
    assert "pdftotext" in skills[0].detail


def test_skill_router_runs_end_to_end_with_mock():
    s = SkillRouter(MockDecisionBackend(), SKILLS).suggest("Vercel にデプロイしたい")
    assert s.shortlist and s.shortlist[0] == "deploy"


# --- 広告運用: 検索語句 --------------------------------------------------------
CTX = AdvertiserContext(offering="法人向け勤怠管理SaaS", brand_terms=["キンタイ"],
                        existing_negatives=["無料 ダウンロード"])


def _intent_backend(table):
    """table[search_term] = (intent, intent_p, relevance)."""
    def fn(state, qid, q):
        intent, p, rel = table[state["search_term"]]
        return one_hot(q, intent, p) if qid == "intent" else {"noul": rel}
    return FnBackend(fn)


def test_triage_rules_run_before_model():
    terms = [
        SearchTerm("キンタイ 料金", 100, 10, 5000, 0),          # 指名語
        SearchTerm("勤怠 無料 ダウンロード", 50, 5, 800, 0),     # 既存除外
        SearchTerm("勤怠管理 比較", 80, 8, 4000, 2),             # CV あり
        SearchTerm("勤怠 とは", 30, 1, 100, 0),                  # データ不足
    ]
    b = _intent_backend({})
    out = {d.term: d for d in triage_search_terms(b, terms, CTX)}
    assert out["キンタイ 料金"].action == "keep"
    assert out["勤怠 無料 ダウンロード"].action == "already_negative"
    assert out["勤怠管理 比較"].action == "keep" and out["勤怠管理 比較"].cpa == 2000
    assert out["勤怠 とは"].action == "insufficient_data"
    assert b.calls == []   # どれもモデルに聞いていない


def test_triage_model_stage_and_ordering():
    terms = [
        SearchTerm("勤怠管理 アルバイト 募集", 200, 20, 3000, 0),
        SearchTerm("勤怠管理 システム 導入", 150, 15, 9000, 0),
        SearchTerm("タイムカード 手書き", 90, 9, 1200, 0),
        SearchTerm("ジョブカン 評判", 60, 6, 700, 0),
        SearchTerm("勤怠 アプリ 個人", 70, 7, 5000, 0),
    ]
    b = _intent_backend({
        "勤怠管理 アルバイト 募集": ("job_seeker", 0.9, 0.05),
        "勤怠管理 システム 導入": ("buyer", 0.9, 0.9),
        "タイムカード 手書き": ("unrelated", 0.6, 0.2),      # 確信不足 → 人間
        "ジョブカン 評判": ("competitor", 0.9, 0.5),
        "勤怠 アプリ 個人": ("unrelated", 0.95, 0.1),
    })
    out = triage_search_terms(b, terms, CTX)
    actions = [(d.term, d.action) for d in out]
    assert actions[:2] == [("勤怠 アプリ 個人", "propose_negative"),
                           ("勤怠管理 アルバイト 募集", "propose_negative")]   # 無駄コスト順
    by = dict(actions)
    assert by["タイムカード 手書き"] == "human_review"
    assert by["ジョブカン 評判"] == "human_review"
    assert by["勤怠管理 システム 導入"] == "keep"
    assert all(d.trace for d in out)


def test_search_term_rejects_negative_metrics():
    with pytest.raises(ValueError):
        SearchTerm("x", 1, -1, 0, 0)


# --- 広告運用: 広告文 ----------------------------------------------------------
def test_display_width_counts_fullwidth_as_two():
    assert display_width("abc") == 3
    assert display_width("勤怠") == 4
    assert display_width("ＡＢ1") == 5


def test_check_ad_copy_statuses():
    def backend(probs):
        return FnBackend(lambda s, qid, q: {"noul": probs.get(qid, 0.0)})

    ok = check_ad_copy(backend({}), "勤怠管理をかんたんに", max_width=30)
    assert ok.status == "ok" and ok.width == 20
    fix = check_ad_copy(backend({"guaranteed_effect": 0.9}), "必ず残業が減る", max_width=30)
    assert fix.status == "needs_fix" and fix.violations == ["guaranteed_effect"]
    review = check_ad_copy(backend({"misleading_price": 0.5}), "初月0円", max_width=30)
    assert review.status == "human_review"
    long = check_ad_copy(backend({}), "あ" * 16, max_width=30)
    assert long.status == "needs_fix" and long.violations[0].startswith("length")
    with pytest.raises(ValueError):
        check_ad_copy(backend({}), "x", max_width=30, flag_threshold=0.3, review_threshold=0.5)


# --- 示唆スコア ---------------------------------------------------------------
def _score_backend(table):
    """table[item_name][dimension] = level(one-hot) or distribution list."""
    def fn(state, qid, q):
        v = table[state["item"]["name"]][qid]
        if isinstance(v, list):
            return {"distribution": v}
        return {"distribution": [1.0 if i == v else 0.0 for i in range(len(q.criteria))]}
    return FnBackend(fn)


def test_score_items_weighted_composite_with_code_features():
    items = {"a": {"name": "A"}, "b": {"name": "B"}}
    b = _score_backend({"A": {"skill_fit": 3, "growth_fit": 2}, "B": {"skill_fit": 1, "growth_fit": 1}})
    out = score_items(b, items, TASK_MATCH_DIMENSIONS,
                      code_features={"a": {"availability": 0.5}, "b": {"availability": 1.0}},
                      code_weights={"availability": 0.2})
    assert [s.item_id for s in out] == ["a", "b"]
    a, bb = out
    assert a.composite == pytest.approx((0.6 * 1 + 0.2 * 1 + 0.2 * 0.5) / 1.0)
    assert a.bucket == "hot" and a.drivers[0] == "skill_fit"
    assert bb.composite == pytest.approx((0.6 / 3 + 0.2 * 0.5 + 0.2 * 1.0) / 1.0)
    assert bb.bucket == "warm"
    assert len(b.calls) == 2 and set(b.calls[0][1]) == {"skill_fit", "growth_fit"}  # 1件1回


def test_score_items_uncertain_goes_to_review():
    b = _score_backend({"A": {"impact": [0.4, 0.3, 0.3], "urgency": 2}})
    out = score_items(b, {"a": {"name": "A"}}, PRIORITY_DIMENSIONS)
    assert out[0].uncertain and out[0].bucket == "review"


def test_score_items_validation():
    b = _score_backend({"A": {"impact": 2, "urgency": 2}})
    with pytest.raises(ValueError, match="missing code feature"):
        score_items(b, {"a": {"name": "A"}}, PRIORITY_DIMENSIONS, code_weights={"due": 0.2})
    with pytest.raises(ValueError, match="0..1"):
        score_items(b, {"a": {"name": "A"}}, PRIORITY_DIMENSIONS,
                    code_features={"a": {"due": 3}}, code_weights={"due": 0.2})
    with pytest.raises(ValueError, match="unique"):
        score_items(b, {"a": {"name": "A"}}, PRIORITY_DIMENSIONS, code_weights={"impact": 0.1})
    with pytest.raises(ValueError):
        Dimension("x", "q", ["only"], 1.0)


def test_presets_anchor_every_level():
    for d in TASK_MATCH_DIMENSIONS + PRIORITY_DIMENSIONS:
        Score(d.instructions, list(d.levels))   # 空アンカーがあれば例外
        assert all(level.strip() for level in d.levels)
