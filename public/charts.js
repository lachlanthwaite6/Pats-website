export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (n, d = 0) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-AU", { maximumFractionDigits: d });
export const money = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
      }).format(n);
export const pct = (n) => (n == null ? "—" : fmt(n * 100, 1) + "%");
export function lineChart(
  rows,
  series,
  { xKey = "week", scatter = false, model = null } = {},
) {
  if (!rows.length)
    return '<div class="empty">No observations available.</div>';
  const W = 750,
    H = 290,
    L = 52,
    R = 20,
    T = 20,
    B = 44;
  const numericX = scatter;
  const xs = rows.map((r, i) => (numericX ? r[xKey] : i));
  const ys = rows.flatMap((r) => series.map((s) => r[s.key]));
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs);
  let ymin = Math.min(0, ...ys),
    ymax = Math.max(1, ...ys) * 1.12;
  if (model) {
    const predicted = [
      model.intercept + model.slope * xmin,
      model.intercept + model.slope * xmax,
    ];
    ymin = Math.min(ymin, ...predicted);
    ymax = Math.max(ymax, ...predicted);
  }
  const x = (v) => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R),
    y = (v) => H - B - ((v - ymin) / (ymax - ymin || 1)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${scatter ? "Ranking and sign-up observations" : "Sign-ups and churn over time"}. Exact values in the table below.">`;
  for (let i = 0; i <= 4; i++) {
    const v = ymin + ((ymax - ymin) * i) / 4;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5ebf0"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" fill="#6a7f91" font-size="12">${fmt(v, 0)}</text>`;
  }
  const ticks = numericX
    ? Array.from({ length: 6 }, (_, i) => ({
        pos: xmin + ((xmax - xmin) * i) / 5,
        label: fmt(xmin + ((xmax - xmin) * i) / 5, 1),
      }))
    : rows
        .map((r, i) => ({ pos: xs[i], label: r[xKey].slice(5) }))
        .filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 6)) === 0);
  ticks.forEach((t) => {
    svg += `<text x="${x(t.pos)}" y="${H - 17}" text-anchor="middle" fill="#6a7f91" font-size="12">${escape(t.label)}</text>`;
  });
  for (const s of series) {
    if (!scatter)
      svg += `<polyline points="${rows.map((r, i) => `${x(xs[i])},${y(r[s.key])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.4"/>`;
    rows.forEach((r, i) => {
      svg += `<circle cx="${x(xs[i])}" cy="${y(r[s.key])}" r="${scatter ? 5 : 3}" fill="${s.color}" stroke="white" stroke-width="1"><title>${escape(r.date || r[xKey])}: ${escape(s.label)} ${fmt(r[s.key], 1)}</title></circle>`;
    });
  }
  if (model)
    svg += `<line x1="${x(xmin)}" y1="${y(model.intercept + model.slope * xmin)}" x2="${x(xmax)}" y2="${y(model.intercept + model.slope * xmax)}" stroke="#b74755" stroke-width="2" stroke-dasharray="5 4"/>`;
  return svg + "</svg>";
}
export function bars(rows, label, value, format = fmt) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r[value])));
  return rows
    .map(
      (r) =>
        `<div class="bar-row"><div class="bar-top"><span>${escape(r[label])}</span><strong>${format(r[value])}</strong></div><div class="track"><div class="fill" style="width:${(Math.abs(r[value]) / max) * 100}%"></div></div></div>`,
    )
    .join("");
}
