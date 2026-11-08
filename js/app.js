/* =====================================================================
 * Alibaba Cloud CDN with GitHub Pages — front-end logic
 * Plain ES2015+, no dependencies, works from any static host.
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * FR-01: central configuration. Edit ONLY this block.
 * Replace every value wrapped in angle brackets before publishing.
 * ------------------------------------------------------------------- */
const SITE_CONFIG = {
  studentName: "فادي فيصل محمد الحربي",
  studentId: "462106787",
  verificationToken: "462106787-fc7c3965",
  version: 1,
  lastUpdated: "2026-11-08T14:55:00Z",
  originHost: "fadi171.github.io",
  cdnDomain: "<cdn.your-domain.com>"
};

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const isPlaceholder = (v) => typeof v === "string" && /<[^>]+>/.test(v);

  /* ---------- Render config values into every [data-config] node ---------- */
  function renderConfig() {
    let placeholders = 0;
    document.querySelectorAll("[data-config]").forEach((el) => {
      const key = el.getAttribute("data-config");
      const value = SITE_CONFIG[key];
      el.textContent = value === undefined || value === "" ? "—" : String(value);
      if (isPlaceholder(value)) {
        el.classList.add("is-placeholder");
        placeholders += 1;
      }
    });
    const notice = $("#placeholder-notice");
    if (notice) notice.hidden = placeholders === 0;
  }

  /* ---------- Hostname badge (informational, never claims CDN hits) ---------- */
  function renderDeliveryStatus() {
    const host = window.location.hostname || "(local file)";
    const pill = $("#delivery-status");
    const text = pill && pill.querySelector(".status-text");
    const served = $("#served-host");
    if (served) served.textContent = host;
    if (!pill || !text) return;

    const origin = String(SITE_CONFIG.originHost).toLowerCase();
    const cdn = String(SITE_CONFIG.cdnDomain).toLowerCase();
    let state = "local";
    let label = "Running locally: not deployed";

    if (window.location.protocol === "file:") {
      label = "Opened as a local file: use a local server";
    } else if (host === "localhost" || host === "127.0.0.1") {
      label = "Local preview server";
    } else if (!isPlaceholder(SITE_CONFIG.cdnDomain) && host === cdn) {
      state = "cdn";
      label = "Served via accelerated domain " + host;
    } else if (host === origin || host.endsWith(".github.io")) {
      state = "origin";
      label = "Served directly from GitHub Pages origin";
    } else {
      state = "other";
      label = "Served from " + host;
    }
    pill.dataset.state = state;
    text.textContent = label;
  }

  /* ---------- FR-02: fetch api/news.json ---------- */
  const card = $("#api-card");
  const ui = {
    label: $("#api-state-label"),
    meta: $("#api-meta"),
    message: $("#api-message"),
    version: $("#api-version"),
    status: $("#api-status"),
    time: $("#api-time"),
    mismatch: $("#api-mismatch"),
    button: $("#reload-json")
  };

  function setState(state, labelText) {
    if (card) card.dataset.state = state;
    if (ui.label) ui.label.textContent = labelText;
  }

  async function loadNews() {
    if (!card) return;
    setState("loading", "Loading…");
    ui.message.textContent = "Requesting api/news.json…";
    ui.version.textContent = "—";
    ui.status.textContent = "—";
    ui.meta.textContent = "";
    ui.mismatch.hidden = true;
    if (ui.button) ui.button.disabled = true;

    const started = performance.now();
    try {
      // Fetch behaviour specified by the assignment. "no-store" bypasses the
      // browser HTTP cache only; the CDN edge may still answer from its cache.
      const response = await fetch("api/news.json", { cache: "no-store" });
      ui.status.textContent = response.status + " " + (response.statusText || "");

      if (!response.ok) {
        throw new Error("HTTP " + response.status + " while loading api/news.json");
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error("Response is not valid JSON");
      }
      if (!data || typeof data.message !== "string" || typeof data.version !== "number") {
        throw new Error("JSON is missing the expected \"message\" (string) and \"version\" (number) fields");
      }

      const ms = Math.round(performance.now() - started);
      setState("success", "Loaded");
      ui.message.textContent = data.message;
      ui.version.textContent = String(data.version);
      ui.meta.textContent = ms + " ms";

      // Helpful during the purge test: page HTML and JSON may come from
      // different cache entries and therefore show different versions.
      if (Number(data.version) !== Number(SITE_CONFIG.version)) {
        ui.mismatch.hidden = false;
        ui.mismatch.textContent =
          "Note: page shows Version " + SITE_CONFIG.version + " but JSON reports Version " +
          data.version + ". One of the two responses is probably a stale cached copy.";
      }
    } catch (error) {
      setState("error", "Error");
      ui.message.textContent = "Could not load api/news.json: " + error.message;
      if (ui.status.textContent === "—") ui.status.textContent = "network error";
    } finally {
      ui.time.textContent = new Date().toISOString();
      if (ui.button) ui.button.disabled = false;
    }
  }

  /* ---------- Init ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    renderConfig();
    renderDeliveryStatus();
    loadNews();
    if (ui.button) ui.button.addEventListener("click", loadNews);
  });
})();
