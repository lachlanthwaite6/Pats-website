import { escape as e, fmt, money, pct, lineChart, bars } from "./charts.js";
const $ = (id) => document.getElementById(id);
let data = null;
let busy = false;
const titles = {
  overview: [
    "Portfolio overview",
    "Customer movement, margins and market position.",
  ],
  plans: [
    "Plan analysis",
    "Explore acquisition signals by network, customer type and book.",
  ],
  elasticity: [
    "Ranking & sign-ups",
    "An exploratory relationship, not a causal pricing forecast.",
  ],
  backbook: [
    "Back-book review",
    "Legacy plan classifications and the margin trade-off.",
  ],
  competitors: ["Competitor movement", "Where customers went when they left."],
  quality: [
    "Data quality",
    "Source coverage, assumptions and checks to resolve.",
  ],
};
const card = (label, value, note = "", accent = false) =>
  `<article class="stat ${accent ? "accent" : ""}"><p>${e(label)}</p><strong>${e(value)}</strong><small>${e(note)}</small></article>`;
const callout = (text, info = false) =>
  `<div class="callout ${info ? "info" : ""}">${e(text)}</div>`;
const panel = (title, body, sub = "") =>
  `<section class="panel"><div class="panel-head"><div><h2>${e(title)}</h2>${sub ? `<p class="subtext">${e(sub)}</p>` : ""}</div></div>${body}</section>`;
const table = (headers, rows) =>
  `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const options = (values, all = "All") =>
  `<option value="">${e(all)}</option>` +
  values.map((v) => `<option value="${e(v)}">${e(v)}</option>`).join("");
const uniques = (key) => [...new Set(data.plans.map((p) => p[key]))].sort();
function render() {
  if (!data) return;
  const page =
    location.hash.slice(1) in titles ? location.hash.slice(1) : "overview";
  const [title, desc] = titles[page];
  $("page-title").textContent = title;
  $("page-description").textContent = desc;
  $("breadcrumb").textContent = title;
  document.querySelectorAll("nav a").forEach((a) => {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("view").hidden = false;
  $("state").hidden = true;
  ({ overview, plans, elasticity, backbook, competitors, quality })[page]();
}
function overview() {
  const o = data.overview;
  $("view").innerHTML =
    `<section class="stats">${card("Portfolio customers", fmt(o.totalCustomers), "Mixed reporting dates", true)}${card("Front-book", fmt(o.frontBook), "Latest dataset date")}${card("Back-book", fmt(o.backBook), "Each plan’s last report")}${card("Portfolio gross margin", pct(o.margin), "Reference floor: 10%")}${card("Median EME rank", fmt(o.medianRank, 1), "Reference target: 5th")}${card("Acquisition cost", "Not measured", "No spend dataset supplied")}</section>
 <div class="grid"><section class="panel"><div class="panel-head"><div><h2>Customer movement</h2><p class="subtext">Weekly sign-ups and losses</p></div><label>Period<select id="trend-period"><option value="12">Last 12 weeks</option><option value="4">Last 4 weeks</option><option value="all">All history</option></select></label></div><div class="legend"><span>Sign-ups</span><span>Churn</span></div><div class="chart" id="trend-chart"></div><details><summary>View weekly values</summary><div id="trend-table"></div></details></section>
 ${panel(
   "Portfolio composition",
   bars(
     [
       { label: "Front-book", value: o.frontBook },
       { label: "Back-book", value: o.backBook },
     ],
     "label",
     "value",
   ) +
     `<dl class="metric-list"><div><dt>Latest demand snapshot</dt><dd>${fmt(o.latestDemandCustomers)}</dd></div><div><dt>Base-table customers</dt><dd>${fmt(o.baseTableCustomers)}</dd></div><div><dt>Source date</dt><dd>${e(data.meta.demandAsOf)}</dd></div></dl>`,
   "Counts use different reporting coverage",
 )}</div>
 ${callout("Customer totals are not fully reconciled. The portfolio combines reporting dates; the demand and margin tables use different customer populations. See Data quality before using these figures for decisions.")}`;
  const draw = () => {
    const period = $("trend-period").value;
    const rows =
      period === "all" ? data.trend : data.trend.slice(-Number(period));
    $("trend-chart").innerHTML = lineChart(rows, [
      { key: "wins", label: "Sign-ups", color: "#087e8a" },
      { key: "losses", label: "Churn", color: "#b74755" },
    ]);
    $("trend-table").innerHTML = table(
      ["Week starting", "Sign-ups", "Churn"],
      rows.map((r) => [r.week, r.wins, r.losses]),
    );
  };
  $("trend-period").addEventListener("change", draw);
  draw();
}
function plans() {
  $("view").innerHTML =
    `<section class="panel"><div class="filters"><label>Network<select id="network">${options(uniques("network"))}</select></label><label>Customer type<select id="customer-type">${options(uniques("customerType"))}</select></label><label>Book<select id="book">${options(["Front-Book", "Back-Book"])}</select></label><label>Status<select id="status">${options(uniques("status"))}</select></label><label>Find a plan<input id="plan-search" type="search" placeholder="Plan code…" maxlength="150"></label><button id="reset-plans" class="button">Reset</button></div><div id="plan-summary" class="small" role="status"></div><div id="plan-table"></div><div class="pager"><button class="button" id="previous">Previous</button><span id="page-count"></span><button class="button" id="next">Next</button></div></section>${callout("Acquisition flags apply only to front-book plans. Fewer than 2 sign-ups in 28 days with at least 15 competitors is flagged for review. An unmatched market or missing metadata is not a healthy result.", true)}`;
  let page = 0,
    filtered = [];
  const draw = () => {
    filtered = data.plans.filter(
      (r) =>
        (!$("network").value || r.network === $("network").value) &&
        (!$("customer-type").value ||
          r.customerType === $("customer-type").value) &&
        (!$("book").value || r.book === $("book").value) &&
        (!$("status").value || r.status === $("status").value) &&
        r.code.toLowerCase().includes($("plan-search").value.toLowerCase()),
    );
    const pages = Math.max(1, Math.ceil(filtered.length / 20));
    page = Math.min(page, pages - 1);
    const shown = filtered.slice(page * 20, page * 20 + 20);
    $("plan-summary").textContent =
      `${fmt(filtered.length)} plans · ${fmt(filtered.reduce((a, r) => a + r.customers, 0))} reported customers`;
    $("plan-table").innerHTML = shown.length
      ? table(
          [
            "Plan",
            "Network",
            "Type",
            "Book",
            "Customers",
            "As of",
            "28-day sign-ups",
            "Competitors",
            "Status",
          ],
          shown.map((r) => [
            r.code,
            r.network,
            r.customerType,
            r.book,
            fmt(r.customers),
            r.asOf || "No report",
            fmt(r.recentSignups),
            fmt(r.competitors, 1),
            r.status,
          ]),
        )
      : '<div class="empty">No plans match these filters.</div>';
    $("page-count").textContent = `Page ${page + 1} of ${pages}`;
    $("previous").disabled = page === 0;
    $("next").disabled = page >= pages - 1;
  };
  ["network", "customer-type", "book", "status", "plan-search"].forEach((id) =>
    $(id).addEventListener(id === "plan-search" ? "input" : "change", () => {
      page = 0;
      draw();
    }),
  );
  $("previous").onclick = () => {
    page--;
    draw();
  };
  $("next").onclick = () => {
    page++;
    draw();
  };
  $("reset-plans").onclick = () => {
    ["network", "customer-type", "book", "status", "plan-search"].forEach(
      (id) => ($(id).value = ""),
    );
    page = 0;
    draw();
  };
  draw();
}
function elasticity() {
  const { points, model } = data.elasticity;
  $("view").innerHTML =
    panel(
      "Historical observations",
      `<div class="chart">${lineChart(points, [{ key: "weeklyRate", label: "7-day sign-up rate", color: "#087e8a" }], { xKey: "rank", scatter: true, model })}</div><p class="small">Horizontal: average EME rank · Vertical: sign-ups per 7 days · Dashed line: fitted association</p>`,
    ) +
    (model
      ? `<div class="grid">${panel("Explore a ranking", `<label for="target-rank">Average rank: <strong id="rank-label"></strong></label><input id="target-rank" type="range" min="${model.minRank}" max="${model.maxRank}" step="0.01" value="${model.xMean}"><p class="small">Observed range: ${fmt(model.minRank, 2)}–${fmt(model.maxRank, 2)}</p>`)}${panel("Estimated mean sign-up rate", '<p class="forecast" id="forecast"></p><p id="confidence" class="subtext"></p><p id="model-warning" class="small"></p>')}</div>`
      : callout("There are not enough varied observations to fit a model.")) +
    callout(
      `This is an observational ranking model using ${points.length} windows, not a measure of price elasticity. Short windows are normalised to 7 days; the interval estimates the fitted mean, not a prediction interval for a future week.`,
    ) +
    panel(
      "Model context",
      `<dl class="metric-list"><div><dt>Observations</dt><dd>${points.length}</dd></div><div><dt>R²</dt><dd>${model ? fmt(model.r2, 3) : "—"}</dd></div><div><dt>Relationship</dt><dd>${model ? (model.slope > 0 ? "Worse rank associated with more sign-ups" : "Better rank associated with more sign-ups") : "Not estimated"}</dd></div></dl><details><summary>View model observations</summary>${table(
        [
          "Window start",
          "Window end",
          "Days",
          "Mean rank",
          "Sign-ups",
          "7-day rate",
        ],
        points.map((r) => [
          r.date,
          r.end,
          r.days,
          fmt(r.rank, 2),
          r.wins,
          fmt(r.weeklyRate, 1),
        ]),
      )}</details>`,
    );
  if (model) {
    const update = () => {
      const x = Number($("target-rank").value),
        fit = model.intercept + model.slope * x,
        se = Math.sqrt(
          model.residualVariance *
            (1 / model.n + (x - model.xMean) ** 2 / model.sxx),
        ),
        delta = model.tCritical * se;
      $("rank-label").textContent = fmt(x, 2);
      $("forecast").textContent = fmt(fit, 1) + " / week";
      $("confidence").textContent =
        `95% confidence interval for mean: ${fmt(fit - delta, 1)} to ${fmt(fit + delta, 1)}`;
      $("model-warning").textContent =
        fit < 0
          ? "The fitted value is negative. This model is unsuitable at this ranking."
          : model.slope > 0
            ? "The counterintuitive slope may reflect confounding or the small sample; do not use it as a pricing rule."
            : "Other drivers of sign-ups are not controlled in this model.";
    };
    $("target-rank").addEventListener("input", update);
    update();
  }
}
function backbook() {
  const o = data.overview;
  $("view").innerHTML =
    `<section class="stats">${card("Portfolio gross margin", pct(o.margin), "Paired valid price and margin rows", true)}${card("Legacy margin at stake", money(o.marginAtStake), "Sum across listed statuses")}${card("Legacy churn cost", money(o.churnCost), "Workbook annual-margin measure")}</section>` +
    panel(
      "Plans by decision status",
      table(
        [
          "Status",
          "Plans",
          "Customers",
          "Mean plan margin",
          "Margin at stake",
          "Churn cost",
        ],
        data.backbook.map((r) => [
          r.status,
          r.plans,
          fmt(r.customers),
          pct(r.meanPlanMargin),
          money(r.marginAtStake),
          money(r.churnCost),
        ]),
      ),
      "Mean plan margin is an unweighted average, unlike the portfolio revenue-weighted ratio.",
    ) +
    callout(
      "Statuses are classifications from the supplied workbook, not automatic recommendations. Margin-at-stake and churn measures depend on workbook assumptions and customer coverage.",
    ) +
    panel(
      "How to read the statuses",
      `<dl class="metric-list"><div><dt>Free win</dt><dd>Workbook indicates no margin sacrifice on transfer.</dd></div><div><dt>Move + reprice</dt><dd>Review transfer and revised price together.</dd></div><div><dt>Costs to retain</dt><dd>Compare retention cost and churn exposure.</dd></div><div><dt>Hold / No live equivalent</dt><dd>No clear transfer case or missing comparable plan.</dd></div><div><dt>Excluded categories</dt><dd>Not assessed; do not treat as zero risk.</dd></div></dl>`,
    );
}
function competitors() {
  const c = data.competitors;
  $("view").innerHTML =
    `<section class="stats">${card("Churn destination identified", pct(c.lossIdentification), "Weighted by event count", true)}${card("Sign-up origin identified", pct(c.winIdentification), "Unknown origins stay unknown")}${card("Recorded loss events", fmt(c.lossEvents), "Full detail-sheet coverage")}</section>` +
    `<div class="grid">${panel("Leading churn destinations", bars(c.top, "name", "customers"), "Known destinations · Full history")}${panel(
      "Movement coverage",
      `<p class="subtext">This analysis counts loss events, which may not equal distinct people. Competitor identification is weighted by the number of events in each record.</p>${callout("Unknown destinations are excluded from the ranking but included in the identification-rate denominator.", true)}<details><summary>View destination counts</summary>${table(
        ["Competitor", "Loss events"],
        c.top.map((r) => [r.name, fmt(r.customers)]),
      )}</details>`,
    )}</div>`;
}
function quality() {
  const warnings = data.quality.filter((q) => q.severity === "warning").length;
  $("view").innerHTML =
    `<section class="stats">${card("Review items", fmt(warnings), "Checks requiring interpretation", true)}${card("Source demand date", data.meta.demandAsOf, "No live connection")}${card("Pipeline version", data.meta.pipelineVersion, "Reproducible offline import")}</section>` +
    panel(
      "Validation and assumptions",
      data.quality
        .map(
          (q) =>
            `<article class="issue"><span class="pill ${q.severity === "warning" ? "warning" : q.severity === "error" ? "error" : ""}">${e(q.severity.toUpperCase())}</span><p>${e(q.message)}</p></article>`,
        )
        .join(""),
    ) +
    panel(
      "Source provenance",
      table(
        ["Field", "Value"],
        [
          ["Workbook", data.meta.sourceFile],
          ["Imported at", data.meta.generatedAt],
          ["Demand as of", data.meta.demandAsOf],
          ["Rankings as of", data.meta.rankingAsOf],
          ["Events as of", data.meta.eventsAsOf],
          ["SHA-256", data.meta.sourceSha256],
        ],
      ),
    ) +
    callout(
      "External API adapters are prepared but none are connected. This dashboard displays a saved snapshot; refreshing does not fetch live business systems.",
      true,
    );
}
async function load() {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  if (!data) {
    $("state").hidden = false;
    $("state").textContent = "Loading the latest validated snapshot…";
  }
  try {
    const response = await fetch("/api/v1/dashboard", {
      cache: "no-cache",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(
        body.message ||
          (response.status === 401
            ? "Sign-in is required to view this dataset."
            : `Data unavailable (${response.status}). Try again shortly.`),
      );
    }
    const next = await response.json();
    if (
      next.schemaVersion !== 1 ||
      !next.overview ||
      !Array.isArray(next.plans)
    )
      throw Error("Unsupported dataset version.");
    data = next;
    $("source-badge").textContent = data.meta.isSample
      ? "Synthetic sample"
      : "Workbook snapshot";
    $("sidebar-date").textContent = "Demand · " + data.meta.demandAsOf;
    $("data-dates").textContent =
      `Demand: ${data.meta.demandAsOf} · Rankings: ${data.meta.rankingAsOf} · Events: ${data.meta.eventsAsOf}`;
    render();
  } catch (error) {
    $("state").hidden = false;
    $("state").className = "error";
    $("state").textContent =
      (data ? "Refresh failed. Showing the last loaded snapshot. " : "") +
      error.message;
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}
window.addEventListener("hashchange", render);
$("refresh").addEventListener("click", load);
load();
