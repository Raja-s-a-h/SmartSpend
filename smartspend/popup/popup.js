// SmartSpend popup logic

const send = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

// ---------- Tabs ----------

document.querySelectorAll(".ss-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ss-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".ss-tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Prices tab ----------

function badgeClass(verdict) {
  return { "best-price": "good", "good-deal": "good", "average": "neutral", "above-average": "warn", "not-enough-data": "neutral" }[verdict] || "neutral";
}
function badgeLabel(verdict) {
  return {
    "best-price": "Best price",
    "good-deal": "Good deal",
    "average": "Typical",
    "above-average": "Above avg",
    "not-enough-data": "New",
  }[verdict] || "New";
}

async function renderPrices() {
  const res = await send({ type: "GET_PRICE_STATS_ALL" });
  const list = document.getElementById("prices-list");
  const empty = document.getElementById("prices-empty");
  list.innerHTML = "";

  const entries = Object.entries(res.data || {});
  if (entries.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  entries
    .sort((a, b) => (b[1].points.at(-1)?.ts || 0) - (a[1].points.at(-1)?.ts || 0))
    .forEach(([key, stats]) => {
      const card = document.createElement("div");
      card.className = "ss-card-item";
      card.innerHTML = `
        <div class="ss-card-item-top">
          <div>
            <div class="ss-item-title">${escapeHtml(stats.title || stats.domain)}</div>
            <div class="ss-item-domain">${escapeHtml(stats.domain)}</div>
          </div>
          <span class="ss-badge ${badgeClass(stats.verdict)}">${badgeLabel(stats.verdict)}</span>
        </div>
        <div class="ss-item-stats">
          <span>Now <b>${stats.currency} ${fmt(stats.current)}</b></span>
          <span>Low <b>${stats.currency} ${fmt(stats.min)}</b></span>
          <span>Avg <b>${stats.currency} ${fmt(stats.avg)}</b></span>
        </div>
        <div class="ss-item-actions">
          <button class="ss-remove-btn" data-key="${escapeAttr(key)}">Remove</button>
        </div>
      `;
      card.querySelector(".ss-item-title").addEventListener("click", () => {
        if (stats.url) chrome.tabs.create({ url: stats.url });
      });
      card.querySelector(".ss-remove-btn").addEventListener("click", async (e) => {
        await send({ type: "DELETE_PRICE_ENTRY", key: e.target.dataset.key });
        renderPrices();
      });
      list.appendChild(card);
    });
}

function fmt(n) {
  return typeof n === "number" ? n.toFixed(2) : "—";
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ---------- Subscriptions tab ----------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const MS = 1000 * 60 * 60 * 24;
  return Math.ceil((new Date(dateStr) - new Date()) / MS);
}

async function renderSubs() {
  const [subsRes, totalRes] = await Promise.all([
    send({ type: "GET_SUBSCRIPTIONS" }),
    send({ type: "GET_MONTHLY_TOTAL" }),
  ]);

  const subs = subsRes.data || [];
  const list = document.getElementById("subs-list");
  const empty = document.getElementById("subs-empty");
  const summary = document.getElementById("subs-summary");
  list.innerHTML = "";

  if (subs.length === 0) {
    empty.hidden = false;
    summary.hidden = true;
    return;
  }
  empty.hidden = true;
  summary.hidden = false;
  document.getElementById("subs-total").textContent = `${totalRes.currency} ${totalRes.total.toFixed(2)}`;

  subs
    .slice()
    .sort((a, b) => new Date(a.trialEnd || a.nextCharge || 0) - new Date(b.trialEnd || b.nextCharge || 0))
    .forEach((sub) => {
      const watchDate = sub.trialEnd || sub.nextCharge;
      const days = daysUntil(watchDate);
      let badge = { cls: "neutral", label: "Scheduled" };
      if (days !== null) {
        if (days <= 1) badge = { cls: "danger", label: days <= 0 ? "Today" : "Tomorrow" };
        else if (days <= 3) badge = { cls: "warn", label: `${days} days` };
        else badge = { cls: "neutral", label: `${days} days` };
      }

      const card = document.createElement("div");
      card.className = "ss-card-item";
      card.innerHTML = `
        <div class="ss-card-item-top">
          <div>
            <div class="ss-item-title">${escapeHtml(sub.name)}</div>
            <div class="ss-item-domain">${sub.trialEnd ? "Trial ends" : "Renews"} ${watchDate ? new Date(watchDate).toLocaleDateString() : "—"}</div>
          </div>
          <span class="ss-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="ss-item-stats">
          <span><b>${sub.currency} ${fmt(Number(sub.amount))}</b> / ${sub.cycle}</span>
        </div>
        <div class="ss-item-actions">
          <button class="ss-remove-btn" data-id="${escapeAttr(sub.id)}">Remove</button>
        </div>
      `;
      card.querySelector(".ss-remove-btn").addEventListener("click", async (e) => {
        await send({ type: "DELETE_SUBSCRIPTION", id: e.target.dataset.id });
        renderSubs();
      });
      list.appendChild(card);
    });
}

// ---------- Add subscription form ----------

const form = document.getElementById("sub-form");
const addBtn = document.getElementById("add-sub-btn");
const cancelBtn = document.getElementById("cancel-sub-btn");

addBtn.addEventListener("click", () => {
  form.hidden = !form.hidden;
});
cancelBtn.addEventListener("click", () => {
  form.reset();
  form.hidden = true;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("f-name").value;
  const amount = document.getElementById("f-amount").value;
  const currency = document.getElementById("f-currency").value;
  const cycle = document.getElementById("f-cycle").value;
  const date = document.getElementById("f-date").value;
  const notes = document.getElementById("f-notes").value;

  await send({
    type: "ADD_SUBSCRIPTION",
    payload: { name, amount, currency, cycle, nextCharge: date, notes },
  });

  form.reset();
  form.hidden = true;
  renderSubs();
});

// ---------- Init ----------

renderPrices();
renderSubs();
