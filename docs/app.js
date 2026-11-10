"use strict";

const state = { data: null, category: "all", keyword: "", unreadOnly: false };

const READ_KEY = "mai-news-read";
const THEME_KEY = "mai-news-theme";

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- 既読管理（localStorage に開いた記事の URL を記録） ----
function loadRead() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch (e) {
    return new Set();
  }
}
const readSet = loadRead();

function saveRead() {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...readSet].slice(-500)));
  } catch (e) {}
}

function markRead(url) {
  if (url && !readSet.has(url)) {
    readSet.add(url);
    saveRead();
  }
}

// ---- ダークモード ----
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
}

function initTheme() {
  let t = document.documentElement.dataset.theme;
  if (!t) {
    try {
      t =
        localStorage.getItem(THEME_KEY) ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch (e) {
      t = "light";
    }
  }
  applyTheme(t);
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    applyTheme(next);
  });
}

// ---- 検索ハイライト ----
function highlight(text) {
  const raw = String(text || "");
  const kw = state.keyword.trim();
  if (!kw) return esc(raw);
  const pattern = new RegExp(
    esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi"
  );
  return esc(raw).replace(pattern, "<mark>$&</mark>");
}

function labelOf(id) {
  const c = (state.data.categories || []).find((c) => c.id === id);
  return c ? c.label : id;
}

function cardHTML(a) {
  const meta = [a.source, a.date].filter(Boolean).join(" ・ ");
  const isRead = readSet.has(a.url);
  return (
    '<a class="card' + (isRead ? " read" : "") + '" href="' + esc(a.url) +
    '" target="_blank" rel="noopener" data-url="' + esc(a.url) + '">' +
    '<span class="badge">' + esc(labelOf(a.category)) + "</span>" +
    (isRead ? '<span class="badge read-badge">既読</span>' : "") +
    "<h3>" + highlight(a.title) + "</h3>" +
    (a.summary ? "<p>" + highlight(a.summary) + "</p>" : "") +
    '<span class="meta">' + esc(meta) + "</span>" +
    "</a>"
  );
}

function render() {
  const articles = state.data.articles || [];
  const kw = state.keyword.trim().toLowerCase();
  const matchKw = (a) =>
    !kw ||
    (a.title + " " + (a.summary || "") + " " + (a.source || ""))
      .toLowerCase()
      .includes(kw);
  const matchRead = (a) => !state.unreadOnly || !readSet.has(a.url);

  // 今日の注目: カテゴリごとの最新1件（「すべて」表示・検索なし・未読フィルタなしのときだけ出す）
  const showTop = state.category === "all" && !kw && !state.unreadOnly;
  $("#top-section").style.display = showTop ? "" : "none";
  if (showTop) {
    const tops = [];
    for (const c of state.data.categories) {
      const latest = articles.find((a) => a.category === c.id);
      if (latest) tops.push(latest);
    }
    $("#top-cards").innerHTML = tops.map(cardHTML).join("");
  }

  const list = articles.filter(
    (a) =>
      (state.category === "all" || a.category === state.category) &&
      matchKw(a) &&
      matchRead(a)
  );
  $("#list-title").textContent =
    state.category === "all" ? "すべての記事" : labelOf(state.category) + "の記事";
  $("#cards").innerHTML = list.map(cardHTML).join("");
  $("#empty").hidden = list.length > 0;
}

// ---- トレンドキーワード（タイトルから頻出語を簡易抽出） ----
const STOPWORDS = new Set([
  "こと", "もの", "ため", "よう", "これ", "さん", "選手", "日本",
  "発表", "開催", "決定", "開始", "公開", "発売", "登場", "実施",
  "予定", "大会", "試合", "結果", "速報", "最新", "動画", "写真",
  "情報", "ニュース", "について", "として", "による", "から", "まで",
]);

function trendTokens(title) {
  const tokens = [];
  const runs =
    String(title || "").match(/[一-龯々]+|[ァ-ヶー]+|[A-Za-z][A-Za-z0-9+#]*/g) || [];
  for (const run of runs) {
    if (/^[A-Za-z]/.test(run)) {
      if (run.length >= 2) tokens.push(run);
      continue;
    }
    // 漢字・カタカナの塊はそのまま（短い場合）と2文字の切り出しの両方を数える
    if (run.length >= 2 && run.length <= 5) tokens.push(run);
    for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

function extractTrends(articles) {
  const counts = new Map();
  for (const a of articles) {
    const seen = new Set(); // 1記事内では同じ語を1回だけ数える
    for (const t of trendTokens(a.title)) {
      if (STOPWORDS.has(t) || seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 10)
    .map(([w]) => w);
}

function buildTrends() {
  const words = extractTrends(state.data.articles || []);
  const section = $("#trend-section");
  if (!words.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $("#trend-chips").innerHTML = words
    .map((w) => '<button class="chip" type="button">' + esc(w) + "</button>")
    .join("");
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const word = chip.textContent;
      $("#search").value = word;
      state.keyword = word;
      state.category = "all";
      buildTabs();
      render();
      $("#list-title").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function buildTabs() {
  const tabs = [{ id: "all", label: "すべて" }, ...state.data.categories];
  $("#tabs").innerHTML = tabs
    .map(
      (c) =>
        '<button class="tab' + (c.id === state.category ? " active" : "") +
        '" data-id="' + c.id + '">' + c.label + "</button>"
    )
    .join("");
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.id;
      buildTabs();
      render();
    });
  });
}

async function init() {
  initTheme();
  try {
    const resp = await fetch("articles.json", { cache: "no-store" });
    state.data = await resp.json();
  } catch (e) {
    $("#updated").textContent = "読み込みに失敗しました。通信環境を確認して再読み込みしてください。";
    return;
  }
  $("#updated").textContent = state.data.generated_at || "";
  buildTabs();
  buildTrends();
  render();
  $("#search").addEventListener("input", (e) => {
    state.keyword = e.target.value;
    render();
  });
  $("#unread-toggle").addEventListener("click", () => {
    state.unreadOnly = !state.unreadOnly;
    const btn = $("#unread-toggle");
    btn.classList.toggle("active", state.unreadOnly);
    btn.setAttribute("aria-pressed", String(state.unreadOnly));
    render();
  });
  // カードを開いたら既読にする
  document.addEventListener("click", (e) => {
    const card = e.target.closest("a.card");
    if (card) markRead(card.dataset.url || card.href);
  });
  // 元記事から戻ってきたら既読表示・未読フィルタを反映する
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.data) render();
  });
  window.addEventListener("pageshow", () => {
    if (state.data) render();
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

init();
