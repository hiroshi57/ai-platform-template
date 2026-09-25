"""CIA World Factbook の「歴史の背景」を、中高生向けの日本語要約にするワークフロー。

AI の要約には誤りが混じりうるため、次の流れで人が確認してから「確認済み」にする。

1. 下書き  : `--draft JPN USA` または `--draft-missing 10`(ANTHROPIC_API_KEY と ANTHROPIC_MODEL が必要)
2. 確認    : 先生などが原文と見比べ、必要なら factbook_ja.json の文章を直す
3. 承認    : `--review JPN --reviewer "山田(社会科)"` で reviewed=true にする
4. 状態確認: `--status`(英語の原文が改訂されると stale=要再確認 になる)

画面では「AI 下書き(確認前)」「確認済み」「原文が改訂されたため要再確認」を区別して表示する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
JA_PATH = HERE / "factbook_ja.json"
# API キーはリポジトリに入れない。このファイル(.gitignore 済み)か環境変数で渡す
ENV_FILE = HERE / ".env.local"
COUNTRIES_PATH = HERE.parent / "site" / "data" / "countries.json"

PROMPT = (
    "次の CIA World Factbook の英文(国の歴史の背景)を、"
    "日本の中学生・高校生が読める日本語で要約してください。\n"
    "- 原文に書かれていない事実を加えない。数字・年・固有名詞は原文どおりにする\n"
    "- 250〜450字程度。です・ます調ではなく、図鑑の説明文のような「だ・である」調\n"
    "- 人名はカタカナまたは一般的な漢字表記にする\n"
    "- 最近の政治家名など時点が古くなりうる情報は「(原文の時点で)」と添える\n\n"
    "国名: {name}\n英文:\n{text}"
)


def source_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()  # noqa: S324 (改訂検知用。安全性は不要)


def merge_translations(countries: dict, ja: dict) -> dict:
    """countries.json の各国に factbook_ja を付ける。原文が変わっていれば stale=True。"""
    for iso3, c in countries.items():
        t = ja.get(iso3)
        en = (c.get("factbook") or {}).get("background")
        if not t or not en:
            c.pop("factbook_ja", None)
            continue
        c["factbook_ja"] = {
            "background_ja": t["background_ja"],
            "by": t.get("by"),
            "at": t.get("at"),
            "reviewed": bool(t.get("reviewed")),
            "reviewer": t.get("reviewer"),
            "stale": t.get("source_sha1") != source_hash(en),
        }
    return countries


def review(ja: dict, iso3: str, reviewer: str, countries: dict) -> dict:
    """人が確認したことを記録する(確認した時点の原文ハッシュも更新)。"""
    if iso3 not in ja:
        raise KeyError(f"{iso3} の下書きがありません")
    if not reviewer.strip():
        raise ValueError("確認者名(--reviewer)が必要です")
    ja[iso3].update({
        "reviewed": True,
        "reviewer": reviewer.strip(),
        "reviewed_at": date.today().isoformat(),
        "source_sha1": source_hash(countries[iso3]["factbook"]["background"]),
    })
    return ja


def status_rows(ja: dict, countries: dict) -> list[tuple[str, str]]:
    rows = []
    for iso3, c in sorted(countries.items()):
        en = (c.get("factbook") or {}).get("background")
        if not en:
            continue
        t = ja.get(iso3)
        if not t:
            st = "未作成"
        elif t.get("source_sha1") != source_hash(en):
            st = "要再確認(原文が改訂)"
        elif t.get("reviewed"):
            st = f"確認済み({t.get('reviewer')})"
        else:
            st = "AI 下書き(確認前)"
        rows.append((iso3, st))
    return rows


def load_env_file(path: Path = ENV_FILE) -> None:
    """KEY=VALUE 形式のファイルを読み、未設定の環境変数だけを補う(値は表示しない)。

    pipeline/.env.local が無ければ、ユーザーフォルダ直下の sekai-zukan.env.txt も探す
    (リポジトリの外なので、誤ってコミットされない)。
    """
    if not path.exists():
        path = Path.home() / "sekai-zukan.env.txt"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def draft_with_claude(name: str, text: str) -> str:
    key, model = os.environ.get("ANTHROPIC_API_KEY"), os.environ.get("ANTHROPIC_MODEL")
    if not key or not model:
        raise RuntimeError(f"ANTHROPIC_API_KEY と ANTHROPIC_MODEL を環境変数か {ENV_FILE} に設定してください")
    body = json.dumps({
        "model": model, "max_tokens": 1200,
        "messages": [{"role": "user", "content": PROMPT.format(name=name, text=text)}],
    }).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310 (固定の https URL)
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
        d = json.loads(r.read().decode("utf-8"))
    return "".join(b.get("text", "") for b in d.get("content", [])).strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--review", metavar="ISO3")
    ap.add_argument("--reviewer", default="")
    ap.add_argument("--draft", nargs="*", metavar="ISO3")
    ap.add_argument("--draft-missing", type=int, metavar="N")
    args = ap.parse_args(argv)
    load_env_file()

    countries = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))["countries"]
    ja = json.loads(JA_PATH.read_text(encoding="utf-8")) if JA_PATH.exists() else {}

    if args.review:
        review(ja, args.review, args.reviewer, countries)
    targets = list(args.draft or [])
    if args.draft_missing:
        targets += [k for k, st in status_rows(ja, countries) if st == "未作成"][: args.draft_missing]
    for i, iso3 in enumerate(targets, 1):
        en = countries[iso3]["factbook"]["background"]
        try:
            text = draft_with_claude(countries[iso3]["name_ja"], en)
        except Exception as e:  # noqa: BLE001  1か国の失敗で全体を止めない
            print(f"draft FAILED: {iso3}: {str(e)[:200]}", file=sys.stderr)
            continue
        ja[iso3] = {
            "background_ja": text,
            "source_sha1": source_hash(en), "by": f"AI 下書き({os.environ.get('ANTHROPIC_MODEL')})",
            "at": date.today().isoformat(), "reviewed": False, "reviewer": None,
        }
        # 途中で止まっても作成済みの分を失わないよう、1か国ごとに保存する
        JA_PATH.write_text(json.dumps(ja, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"draft {i}/{len(targets)}: {iso3}", file=sys.stderr)
    if args.review or targets:
        JA_PATH.write_text(json.dumps(ja, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.status or not (args.review or targets):
        rows = status_rows(ja, countries)
        done = sum(1 for _, st in rows if st.startswith("確認済み"))
        print(f"確認済み {done} / 下書き {sum(1 for _, st in rows if st != '未作成')} / 全 {len(rows)} か国")
        for iso3, st in rows:
            if st != "未作成":
                print(f"  {iso3}: {st}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
