#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マイ・ニュース公開版 - ニュース取得・サイトデータ生成スクリプト

公開 RSS フィードから6カテゴリのニュースを取得し、
docs/articles.json を生成します。Python 標準ライブラリのみ使用。

主フィード : Bing News RSS (mkt=ja-JP) - 要約スニペットと出典が取れる
予備フィード: Google News RSS (hl=ja&gl=JP) - 主フィードで件数が不足したカテゴリ用

著作権配慮: 見出し・短い要約・出典・日付・元記事リンクのみを扱い、記事本文は保存しません。
"""

import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent
OUT_FILE = ROOT / "docs" / "articles.json"
MAX_PER_CATEGORY = 8
MIN_BEFORE_FALLBACK = 3  # これ未満なら Google News RSS で補完する
SUMMARY_MAX = 140
USER_AGENT = "Mozilla/5.0 (compatible; MaiNewsBot/1.0; +https://example.invalid/)"

# カテゴリを追加・変更したい場合はここを編集してください
CATEGORIES = [
    {"id": "ai",       "label": "AI",         "queries": ["AI 人工知能", "生成AI"]},
    {"id": "golf",     "label": "ゴルフ",      "queries": ["ゴルフ ツアー", "ゴルフ"]},
    {"id": "bowling",  "label": "ボウリング",  "queries": ["ボウリング"]},
    {"id": "camp",     "label": "キャンプ",    "queries": ["キャンプ アウトドア", "キャンプ ギア 新製品"]},
    {"id": "apple",    "label": "Apple製品",   "queries": ["Apple 新製品", "iPhone アップル"]},
    {"id": "boatrace", "label": "ボートレース", "queries": ["ボートレース"]},
]

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
ELLIPSIS_RE = re.compile(r"(…{2,}|\.{3,})")
TITLE_NORM_RE = re.compile(r"[\s\"\"''「」『』（）()【】\[\]<>・…、。,.!?！？:：/／\\|｜-]")
SIMILAR_THRESHOLD = 0.65  # タイトルの bigram Jaccard 類似度がこれ以上なら重複とみなす


def clean_text(text: str) -> str:
    """HTMLタグ除去・エンティティ復元・空白正規化"""
    if not text:
        return ""
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = WS_RE.sub(" ", text)
    return text.strip()


def truncate(text: str, limit: int = SUMMARY_MAX) -> str:
    """長さ制限での切り詰め。文の切れ目（。）が後半にあればそこで切り、
    なければ末尾の読点を落として「…」を付ける。"""
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    idx = cut.rfind("。")
    if idx >= limit // 2:
        return cut[: idx + 1]
    return cut.rstrip("、,") + "…"


def polish_summary(title: str, summary: str) -> str:
    """要約の整形: 先頭のタイトル重複を除去し、省略記号を正規化してから切り詰める"""
    s = summary or ""
    if title and s.startswith(title):
        s = s[len(title):].lstrip(" 　・-：:")
    s = ELLIPSIS_RE.sub("…", s)
    s = s.strip(" 　")
    return truncate(s)


def fetch_xml(url: str) -> ET.Element:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return ET.fromstring(resp.read())


def parse_date(raw: str):
    """RFC822 日付 -> (datetime JST, 'YYYY-MM-DD') 。失敗時は (None, '')"""
    if not raw:
        return None, ""
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_jst = dt.astimezone(JST)
        return dt_jst, dt_jst.strftime("%Y-%m-%d")
    except Exception:
        return None, ""


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(item: ET.Element, name: str) -> str:
    """名前空間つきでもローカル名で子要素を探す"""
    for child in item:
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def bing_url(query: str) -> str:
    q = urllib.parse.quote(query)
    return f"https://www.bing.com/news/search?q={q}&format=rss&mkt=ja-JP&setlang=ja"


def google_url(query: str) -> str:
    q = urllib.parse.quote(query)
    return f"https://news.google.com/rss/search?q={q}&hl=ja&gl=JP&ceid=JP:ja"


def unwrap_bing_link(link: str) -> str:
    """Bing の apiclick リダイレクトから元記事 URL を取り出す"""
    try:
        parsed = urllib.parse.urlparse(link)
        params = urllib.parse.parse_qs(parsed.query)
        if "url" in params and params["url"]:
            return params["url"][0]
    except Exception:
        pass
    return link


def fetch_bing(query: str) -> list:
    root = fetch_xml(bing_url(query))
    articles = []
    for item in root.findall(".//item"):
        title = clean_text(item.findtext("title") or "")
        link = unwrap_bing_link((item.findtext("link") or "").strip())
        if not title or not link:
            continue
        dt, date_str = parse_date(item.findtext("pubDate") or "")
        articles.append({
            "title": title,
            "summary": polish_summary(title, clean_text(item.findtext("description") or "")),
            "source": child_text(item, "Source") or "Bing News",
            "url": link,
            "_dt": dt,
            "date": date_str,
        })
    return articles


def fetch_google(query: str) -> list:
    root = fetch_xml(google_url(query))
    articles = []
    for item in root.findall(".//item"):
        raw_title = clean_text(item.findtext("title") or "")
        link = (item.findtext("link") or "").strip()
        if not raw_title or not link:
            continue
        source = child_text(item, "source")
        title = raw_title
        # Google のタイトル末尾 " - 媒体名" を除去（出典は source 側で表示）
        if source and title.endswith(" - " + source):
            title = title[: -(len(source) + 3)].strip()
        dt, date_str = parse_date(item.findtext("pubDate") or "")
        # Google の description は見出しの繰り返しが主。本文要約としては使えないため、
        # 見出しと媒体名を取り除いた残りだけを要約として使う（無ければ空）。
        desc = clean_text(item.findtext("description") or "")
        for part in (raw_title, title, source):
            if part:
                desc = desc.replace(part, " ")
        desc = WS_RE.sub(" ", desc).strip(" 　・-")
        summary = polish_summary(title, desc) if len(desc) >= 20 else ""
        articles.append({
            "title": title,
            "summary": summary,
            "source": source or "Google News",
            "url": link,
            "_dt": dt,
            "date": date_str,
        })
    return articles


def normalize_title(title: str) -> str:
    """タイトル比較用の正規化（空白・記号除去、小文字化）"""
    return TITLE_NORM_RE.sub("", title).lower()


def _bigrams(s: str) -> set:
    if len(s) < 2:
        return {s} if s else set()
    return {s[i:i + 2] for i in range(len(s) - 1)}


def title_similarity(a: str, b: str) -> float:
    """正規化済みタイトル同士の bigram Jaccard 類似度"""
    ba, bb = _bigrams(a), _bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / len(ba | bb)


def dedupe_sort_limit(articles: list, limit: int) -> list:
    seen_urls = set()
    kept_norms = []  # 残した記事の正規化タイトル（類似タイトル除去用）
    unique = []
    for a in articles:
        ukey = a["url"].split("#")[0]
        if ukey in seen_urls:
            continue
        norm = normalize_title(a["title"])
        # 完全一致だけでなく、媒体違いの同一ニュースなど類似タイトルも除去する
        if any(title_similarity(norm, k) >= SIMILAR_THRESHOLD for k in kept_norms):
            continue
        seen_urls.add(ukey)
        kept_norms.append(norm)
        unique.append(a)
    unique.sort(key=lambda a: a["_dt"] or datetime.min.replace(tzinfo=JST), reverse=True)
    return unique[:limit]


def main() -> int:
    all_articles = []
    failures = []
    counts = {}

    for cat in CATEGORIES:
        collected = []
        for query in cat["queries"]:
            try:
                collected.extend(fetch_bing(query))
            except Exception as e:
                msg = f"[WARN] Bing取得失敗 category={cat['id']} query='{query}': {e}"
                print(msg, file=sys.stderr)
                failures.append(msg)
        if len(dedupe_sort_limit(collected, 10**9)) < MIN_BEFORE_FALLBACK:
            for query in cat["queries"]:
                try:
                    collected.extend(fetch_google(query))
                except Exception as e:
                    msg = f"[WARN] Google取得失敗 category={cat['id']} query='{query}': {e}"
                    print(msg, file=sys.stderr)
                    failures.append(msg)
        picked = dedupe_sort_limit(collected, MAX_PER_CATEGORY)
        counts[cat["id"]] = len(picked)
        for a in picked:
            a.pop("_dt", None)
            a["category"] = cat["id"]
            all_articles.append(a)
        print(f"{cat['label']}: {len(picked)}件")

    data = {
        "generated_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M JST"),
        "categories": [{"id": c["id"], "label": c["label"]} for c in CATEGORIES],
        "articles": all_articles,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"生成完了: {OUT_FILE} (合計 {len(all_articles)} 件)")
    if failures:
        print(f"失敗フィード数: {len(failures)}（フォールバックまたは部分取得で継続）")
    empty = [cid for cid, n in counts.items() if n == 0]
    if empty:
        print(f"[ERROR] 0件のカテゴリ: {', '.join(empty)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
