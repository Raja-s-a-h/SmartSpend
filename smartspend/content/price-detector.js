// SmartSpend price detector — runs on every page, quietly bails if no price found.

(function () {
  if (window.__smartspendPriceInjected) return;
  window.__smartspendPriceInjected = true;

  function parseMoney(text) {
    if (!text) return null;
    const cleaned = text.replace(/[,\s]/g, "");
    const match = cleaned.match(/(\d+(\.\d{1,2})?)/);
    if (!match) return null;
    return parseFloat(match[1]);
  }

  function detectCurrency(text) {
    if (!text) return "USD";
    if (text.includes("₹")) return "INR";
    if (text.includes("€")) return "EUR";
    if (text.includes("£")) return "GBP";
    if (text.includes("$")) return "USD";
    return "USD";
  }

  function fromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const candidates = item["@graph"] ? item["@graph"] : [item];
          for (const c of candidates) {
            if (!c) continue;
            const type = c["@type"];
            const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
            if (isProduct) {
              const offers = Array.isArray(c.offers) ? c.offers[0] : c.offers;
              const price = offers?.price || offers?.lowPrice;
              if (price) {
                return {
                  price: parseFloat(price),
                  currency: offers?.priceCurrency || "USD",
                  title: c.name || document.title,
                };
              }
            }
          }
        }
      } catch (e) {
        /* ignore malformed JSON-LD */
      }
    }
    return null;
  }

  function fromMeta() {
    const priceMeta =
      document.querySelector('meta[property="product:price:amount"]') ||
      document.querySelector('meta[property="og:price:amount"]') ||
      document.querySelector('meta[itemprop="price"]');
    if (priceMeta) {
      const price = parseMoney(priceMeta.getAttribute("content"));
      if (price) {
        const currencyMeta = document.querySelector('meta[property="product:price:currency"]');
        return {
          price,
          currency: currencyMeta?.getAttribute("content") || "USD",
          title: document.querySelector('meta[property="og:title"]')?.getAttribute("content") || document.title,
        };
      }
    }
    return null;
  }

  const SITE_SELECTORS = [
    ".a-price .a-offscreen", // Amazon
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "._30jeq3", // Flipkart
    ".x-price-primary span", // eBay
    '[itemprop="price"]', // Walmart / generic schema
    ".product-price",
    ".price-current",
    ".price__current",
  ];

  function fromSelectors() {
    for (const sel of SITE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.getAttribute("content") || el.textContent;
        const price = parseMoney(text);
        if (price) {
          return { price, currency: detectCurrency(text), title: document.title };
        }
      }
    }
    return null;
  }

  function detectPrice() {
    return fromJsonLd() || fromMeta() || fromSelectors();
  }

  function productKey() {
    const path = location.pathname.replace(/\/$/, "");
    return `${location.hostname}${path}`;
  }

  function verdictLabel(v) {
    return {
      "best-price": "Best price seen",
      "good-deal": "Good deal",
      "average": "Typical price",
      "above-average": "Above average — maybe wait",
      "not-enough-data": "Tracking started",
    }[v] || "Tracking started";
  }

  function verdictClass(v) {
    return {
      "best-price": "ss-good",
      "good-deal": "ss-good",
      "average": "ss-neutral",
      "above-average": "ss-warn",
      "not-enough-data": "ss-neutral",
    }[v] || "ss-neutral";
  }

  function drawSparkline(canvas, points) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (points.length < 2) {
      ctx.fillStyle = "#9aa5a6";
      ctx.font = "11px sans-serif";
      ctx.fillText("Not enough history yet", 6, h / 2);
      return;
    }
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const stepX = w / (points.length - 1);

    ctx.beginPath();
    points.forEach((p, i) => {
      const x = i * stepX;
      const y = h - ((p.price - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#e8a84a";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function buildWidget(stats, key) {
    const existing = document.getElementById("smartspend-widget");
    if (existing) existing.remove();

    const wrap = document.createElement("div");
    wrap.id = "smartspend-widget";
    wrap.className = "ss-collapsed";

    wrap.innerHTML = `
      <button class="ss-pill" title="SmartSpend price check">
        <span class="ss-dot ${verdictClass(stats.verdict)}"></span>
        <span>Price Check</span>
      </button>
      <div class="ss-card" hidden>
        <div class="ss-card-header">
          <strong>SmartSpend</strong>
          <button class="ss-close" title="Close">&times;</button>
        </div>
        <div class="ss-verdict ${verdictClass(stats.verdict)}">${verdictLabel(stats.verdict)}</div>
        <div class="ss-stats">
          <div><span>Current</span><b>${stats.currency} ${stats.current?.toFixed(2) ?? "—"}</b></div>
          <div><span>Lowest seen</span><b>${stats.currency} ${stats.min?.toFixed(2) ?? "—"}</b></div>
          <div><span>Average</span><b>${stats.currency} ${stats.avg?.toFixed(2) ?? "—"}</b></div>
        </div>
        <canvas class="ss-sparkline" width="220" height="46"></canvas>
        <div class="ss-footer">Tracked over ${stats.points.length} day${stats.points.length === 1 ? "" : "s"} on this page</div>
      </div>
    `;

    document.body.appendChild(wrap);

    const pill = wrap.querySelector(".ss-pill");
    const card = wrap.querySelector(".ss-card");
    const closeBtn = wrap.querySelector(".ss-close");

    pill.addEventListener("click", () => {
      card.hidden = !card.hidden;
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      wrap.style.display = "none";
    });

    drawSparkline(wrap.querySelector(".ss-sparkline"), stats.points);
  }

  function run() {
    const detected = detectPrice();
    if (!detected || !detected.price) return;

    const payload = {
      key: productKey(),
      domain: location.hostname,
      title: (detected.title || document.title || "").trim().slice(0, 140),
      price: detected.price,
      currency: detected.currency || "USD",
      url: location.href,
    };

    chrome.runtime.sendMessage({ type: "PRICE_DETECTED", payload }, (res) => {
      if (chrome.runtime.lastError || !res?.ok || !res.stats) return;
      buildWidget(res.stats, payload.key);
    });
  }

  // Give dynamic (JS-rendered) pages a moment to finish painting price
  setTimeout(run, 1200);
})();
