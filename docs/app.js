"use strict";

const state = { data: null, category: "all", keyword: "" };

const $ = (sel) => document.querySelector(sel);

function labelOf(id) {
  const c = (state.data.categories || []).find((c) => c.id === id);
  return c ? c.label : id;
}

function cardHTML(a) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const meta = [a.source, a.date].filter(Boolean).join(" ・ ");
  return (
    '<a class="card" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
    '<span class="badge">' + esc(labelOf(a.category)) + "</span>" +
    "<h3>" + esc(a.title) + "</h3>" +
    (a.summary ? "<p>" + esc(a.summary) + "</p>" : "") +
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

  // 今日の注目: カテゴリごとの最新1件（「すべて」表示かつ検索なしのときだけ出す）
  const showTop = state.category === "all" && !kw;
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
    (a) => (state.category === "all" || a.category === state.category) && matchKw(a)
  );
  $("#list-title").textContent =
    state.category === "all" ? "すべての記事" : labelOf(state.category) + "の記事";
  $("#cards").innerHTML = list.map(cardHTML).join("");
  $("#empty").hidden = list.length > 0;
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
  try {
    const resp = await fetch("articles.json", { cache: "no-store" });
    state.data = await resp.json();
  } catch (e) {
    $("#updated").textContent = "読み込みに失敗しました。通信環境を確認して再読み込みしてください。";
    return;
  }
  $("#updated").textContent = state.data.generated_at || "";
  buildTabs();
  render();
  $("#search").addEventListener("input", (e) => {
    state.keyword = e.target.value;
    render();
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

init();
