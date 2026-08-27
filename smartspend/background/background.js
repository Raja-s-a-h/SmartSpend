// SmartSpend background service worker
// Handles: price history storage/stats, subscription CRUD, renewal reminders.

const PRICE_HISTORY_KEY = "priceHistory"; // { [productKey]: {title, domain, url, currency, points:[{price, ts}]} }
const SUBSCRIPTIONS_KEY = "subscriptions"; // [{id, name, amount, currency, cycle, nextCharge, trialEnd, notes, notifiedFor:[]}]
const MAX_POINTS_PER_PRODUCT = 180;
const REMINDER_ALARM = "smartspend-reminder-check";

// ---------- Utilities ----------

function todayStr(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24;
  return Math.round((new Date(b) - new Date(a)) / MS);
}

async function getAll(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res[key] ?? fallback;
}

async function setAll(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---------- Price History ----------

async function recordPrice(payload) {
  const { key, domain, title, price, currency, url } = payload;
  if (!key || typeof price !== "number" || isNaN(price)) return null;

  const history = await getAll(PRICE_HISTORY_KEY, {});
  const entry = history[key] || { title, domain, url, currency, points: [] };

  // Keep freshest title/url/currency
  entry.title = title || entry.title;
  entry.url = url || entry.url;
  entry.currency = currency || entry.currency;
  entry.domain = domain || entry.domain;

  const today = todayStr();
  const lastPoint = entry.points[entry.points.length - 1];

  if (lastPoint && todayStr(lastPoint.ts) === today) {
    // Update today's entry instead of duplicating
    lastPoint.price = price;
    lastPoint.ts = Date.now();
  } else {
    entry.points.push({ price, ts: Date.now() });
    if (entry.points.length > MAX_POINTS_PER_PRODUCT) {
      entry.points = entry.points.slice(entry.points.length - MAX_POINTS_PER_PRODUCT);
    }
  }

  history[key] = entry;
  await setAll(PRICE_HISTORY_KEY, history);
  return computeStats(entry, price);
}

function computeStats(entry, currentPrice) {
  const prices = entry.points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  let verdict = "not-enough-data";
  if (prices.length >= 2) {
    if (currentPrice <= min + (max - min) * 0.05) verdict = "best-price";
    else if (currentPrice <= avg * 0.97) verdict = "good-deal";
    else if (currentPrice >= avg * 1.05) verdict = "above-average";
    else verdict = "average";
  }

  return {
    title: entry.title,
    domain: entry.domain,
    url: entry.url,
    currency: entry.currency,
    points: entry.points,
    min,
    max,
    avg,
    current: currentPrice,
    verdict,
  };
}

async function getAllPriceStats() {
  const history = await getAll(PRICE_HISTORY_KEY, {});
  const out = {};
  for (const [key, entry] of Object.entries(history)) {
    const last = entry.points[entry.points.length - 1];
    out[key] = computeStats(entry, last ? last.price : null);
  }
  return out;
}

async function deletePriceEntry(key) {
  const history = await getAll(PRICE_HISTORY_KEY, {});
  delete history[key];
  await setAll(PRICE_HISTORY_KEY, history);
}

// ---------- Subscriptions ----------

function monthlyEquivalent(sub) {
  const amt = Number(sub.amount) || 0;
  switch (sub.cycle) {
    case "weekly":
      return amt * 4.345;
    case "yearly":
      return amt / 12;
    case "monthly":
    default:
      return amt;
  }
}

async function addSubscription(sub) {
  const subs = await getAll(SUBSCRIPTIONS_KEY, []);
  const newSub = {
    id: crypto.randomUUID(),
    name: sub.name?.trim() || "Untitled subscription",
    amount: Number(sub.amount) || 0,
    currency: sub.currency || "USD",
    cycle: sub.cycle || "monthly",
    nextCharge: sub.nextCharge || null,
    trialEnd: sub.trialEnd || null,
    notes: sub.notes || "",
    notifiedFor: [],
    createdAt: Date.now(),
  };
  subs.push(newSub);
  await setAll(SUBSCRIPTIONS_KEY, subs);
  return newSub;
}

async function updateSubscription(id, patch) {
  const subs = await getAll(SUBSCRIPTIONS_KEY, []);
  const idx = subs.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  subs[idx] = { ...subs[idx], ...patch };
  await setAll(SUBSCRIPTIONS_KEY, subs);
  return subs[idx];
}

async function deleteSubscription(id) {
  const subs = await getAll(SUBSCRIPTIONS_KEY, []);
  await setAll(SUBSCRIPTIONS_KEY, subs.filter((s) => s.id !== id));
}

async function checkSubscriptionReminders() {
  const subs = await getAll(SUBSCRIPTIONS_KEY, []);
  const now = Date.now();
  let changed = false;

  for (const sub of subs) {
    const dateToWatch = sub.trialEnd || sub.nextCharge;
    if (!dateToWatch) continue;

    const daysLeft = daysBetween(now, dateToWatch);
    const label = sub.trialEnd ? "trial ends" : "renews";
    const thresholds = [3, 1, 0];

    for (const t of thresholds) {
      const flag = `${dateToWatch}-${t}`;
      if (daysLeft === t && !sub.notifiedFor.includes(flag)) {
        const when = t === 0 ? "today" : `in ${t} day${t > 1 ? "s" : ""}`;
        chrome.notifications.create(`smartspend-${sub.id}-${t}`, {
          type: "basic",
          iconUrl: "../icons/icon128.png",
          title: `${sub.name} ${label} ${when}`,
          message: `${sub.amount} ${sub.currency} / ${sub.cycle}. Cancel now if you don't want it.`,
          priority: 2,
        });
        sub.notifiedFor.push(flag);
        changed = true;
      }
    }
  }

  if (changed) await setAll(SUBSCRIPTIONS_KEY, subs);
}

// ---------- Alarms ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 180 }); // every 3 hours
  checkSubscriptionReminders();
});

chrome.runtime.onStartup?.addListener(() => {
  checkSubscriptionReminders();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMINDER_ALARM) checkSubscriptionReminders();
});

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "PRICE_DETECTED": {
        const stats = await recordPrice(msg.payload);
        sendResponse({ ok: true, stats });
        break;
      }
      case "GET_PRICE_STATS_ALL": {
        sendResponse({ ok: true, data: await getAllPriceStats() });
        break;
      }
      case "DELETE_PRICE_ENTRY": {
        await deletePriceEntry(msg.key);
        sendResponse({ ok: true });
        break;
      }
      case "GET_SUBSCRIPTIONS": {
        sendResponse({ ok: true, data: await getAll(SUBSCRIPTIONS_KEY, []) });
        break;
      }
      case "ADD_SUBSCRIPTION": {
        sendResponse({ ok: true, data: await addSubscription(msg.payload) });
        break;
      }
      case "UPDATE_SUBSCRIPTION": {
        sendResponse({ ok: true, data: await updateSubscription(msg.id, msg.patch) });
        break;
      }
      case "DELETE_SUBSCRIPTION": {
        await deleteSubscription(msg.id);
        sendResponse({ ok: true });
        break;
      }
      case "GET_MONTHLY_TOTAL": {
        const subs = await getAll(SUBSCRIPTIONS_KEY, []);
        const total = subs.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
        sendResponse({ ok: true, total, currency: subs[0]?.currency || "USD" });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
