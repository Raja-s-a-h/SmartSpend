// SmartSpend subscription detector — flags likely trial/subscription pages
// and offers a one-click "track this" banner. Runs once per page load.

(function () {
  if (window.__smartspendSubInjected) return;
  window.__smartspendSubInjected = true;

  const URL_HINTS = /(checkout|subscribe|signup|sign-up|trial|billing|plan|upgrade)/i;
  const TEXT_HINTS = [
    /free trial/i,
    /trial ends?/i,
    /trial period/i,
    /after (your|the) trial/i,
    /renews? (automatically|on)/i,
    /cancel anytime/i,
    /\$\s?\d+(\.\d{2})?\s*\/\s*(mo|month|yr|year)/i,
    /₹\s?\d+\s*\/\s*(mo|month|yr|year)/i,
  ];

  function pageLooksRelevant() {
    if (URL_HINTS.test(location.href)) return true;
    const bodyText = document.body?.innerText?.slice(0, 20000) || "";
    return TEXT_HINTS.some((re) => re.test(bodyText));
  }

  function guessAmount(text) {
    const match = text.match(/[$₹€£]\s?(\d+(\.\d{1,2})?)\s*\/\s*(mo|month|yr|year)/i);
    if (!match) return { amount: "", cycle: "monthly" };
    const cycle = /yr|year/i.test(match[3]) ? "yearly" : "monthly";
    return { amount: match[1], cycle };
  }

  function guessTrialDays(text) {
    const match = text.match(/(\d{1,3})[\s-]?day(s)?\s*(free\s*)?trial/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function buildBanner() {
    if (document.getElementById("smartspend-sub-banner")) return;

    const bodyText = document.body?.innerText?.slice(0, 20000) || "";
    const { amount, cycle } = guessAmount(bodyText);
    const trialDays = guessTrialDays(bodyText);

    const banner = document.createElement("div");
    banner.id = "smartspend-sub-banner";
    banner.className = "ss-banner";
    banner.innerHTML = `
      <div class="ss-banner-text">
        <strong>Looks like a subscription or trial.</strong>
        <span>Want SmartSpend to remind you before it renews?</span>
      </div>
      <div class="ss-banner-actions">
        <button class="ss-btn-primary" id="ss-track-btn">Track it</button>
        <button class="ss-btn-ghost" id="ss-dismiss-btn">Not now</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("ss-dismiss-btn").addEventListener("click", () => {
      banner.remove();
    });

    document.getElementById("ss-track-btn").addEventListener("click", () => {
      const today = new Date();
      let nextCharge = null;
      let trialEnd = null;

      if (trialDays) {
        const d = new Date(today);
        d.setDate(d.getDate() + trialDays);
        trialEnd = d.toISOString().slice(0, 10);
      } else {
        const d = new Date(today);
        d.setMonth(d.getMonth() + 1);
        nextCharge = d.toISOString().slice(0, 10);
      }

      const payload = {
        name: document.title.split(/[-|–]/)[0].trim().slice(0, 60) || location.hostname,
        amount: amount || "",
        currency: "USD",
        cycle,
        nextCharge,
        trialEnd,
        notes: `Detected on ${location.hostname}`,
      };

      chrome.runtime.sendMessage({ type: "ADD_SUBSCRIPTION", payload }, (res) => {
        banner.innerHTML = `<div class="ss-banner-text"><strong>Added ✓</strong><span>Open the SmartSpend icon to edit details.</span></div>`;
        setTimeout(() => banner.remove(), 3500);
      });
    });
  }

  function run() {
    if (pageLooksRelevant()) buildBanner();
  }

  setTimeout(run, 1500);
})();
