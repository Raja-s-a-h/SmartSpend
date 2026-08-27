# SmartSpend — Price History & Subscription Tracker

A browser extension that does two things:

1. **Price History + Fair-Price Flag** — on any product page, it quietly tracks
   the price over time and shows a small pill in the bottom-right corner
   telling you if the current price is the best seen, a good deal, average,
   or above average — so you know if a "sale" is really a sale.

2. **Subscription / Free-Trial Tracker** — detects checkout, trial, and
   billing pages and offers to track the subscription. It also lets you add
   subscriptions manually, and sends a browser notification 3 days, 1 day,
   and on the day before a trial ends or a renewal charges.

Everything is stored **locally on your device** (`chrome.storage.local`).
Nothing is sent to any server — there's no backend at all.

---

## Folder structure

```
smartspend/
├── manifest.json              ← Chrome / Edge / Brave / Opera (Manifest V3)
├── manifest-firefox.json      ← Firefox variant (rename to manifest.json to use)
├── background/
│   └── background.js          ← storage, price stats, reminder alarms
├── content/
│   ├── price-detector.js      ← finds price on the page, shows the widget
│   ├── subscription-detector.js ← finds trial/subscription pages, shows banner
│   └── widget.css
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── icons/
```

---

## Install — Chrome / Edge / Brave / Opera

1. Unzip this folder anywhere on your computer.
2. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `smartspend` folder.
5. Pin the extension (puzzle-piece icon → pin) so it's easy to reach.

That's it — it uses the `manifest.json` at the root as-is.

## Install — Firefox

Firefox needs a slightly different manifest key for the background script.

1. In the `smartspend` folder, **delete or rename** `manifest.json`.
2. **Rename** `manifest-firefox.json` to `manifest.json`.
3. Go to `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on** and select any file inside the folder
   (e.g. `manifest.json`).

Note: temporary add-ons in Firefox are removed when you restart the browser.
For a permanent install you'd sign the extension via
[addons.mozilla.org](https://addons.mozilla.org) (free, just requires an
account) — happy to walk through that if you want to go that route.

## Install — Safari

Safari doesn't load unpacked web extensions directly — it needs converting
into a Safari App Extension via Xcode:

1. Install Xcode (Mac App Store, free).
2. In Terminal, run:
   ```
   xcrun safari-web-extension-converter /path/to/smartspend
   ```
3. This generates an Xcode project. Open it, hit **Run**, then enable the
   extension in Safari's Settings → Extensions.

This step is Apple's requirement for all Safari extensions, not something
specific to SmartSpend.

---

## How the price detection works

On page load, the content script tries (in order):

1. `application/ld+json` structured data (`@type: Product`)
2. Open Graph / `itemprop="price"` meta tags
3. Known selectors for Amazon, Flipkart, eBay, Walmart, and generic
   `.product-price` / `.price-current` classes
4. If none match, it does nothing — no widget, no noise.

Each page visit stores **one price point per day** per product (identified
by domain + URL path), capped at 180 points (~6 months) so storage stays
small. The verdict badge compares today's price to the historical min/avg:

- **Best price** — at or near the lowest ever recorded
- **Good deal** — meaningfully below average
- **Typical price** — close to average
- **Above average** — noticeably higher than usual, worth waiting

## How subscription detection works

It scans the page URL and visible text for trial/billing language
(e.g. "free trial", "renews automatically", "$9.99/month") on pages that
look like checkout/signup/billing flows. If it finds a match, it shows a
small banner offering to track it — you can also just add subscriptions
manually from the popup at any time. Reminders fire via
`chrome.notifications` 3 days, 1 day, and on the day of the renewal/trial
end date.

## Permissions used, and why

| Permission | Why |
|---|---|
| `storage` | Save price history & subscriptions locally |
| `alarms` | Periodically check for upcoming renewals |
| `notifications` | Show the renewal/trial reminder |
| `activeTab` / `host_permissions` | Read price/trial text on the page you're viewing |

No `identity`, no remote server calls, no analytics.

## Known limitations (worth knowing before you rely on it)

- Price history only builds up from pages **you actually visit** — it's not
  a live price-tracking service watching prices 24/7 in the background.
- Site selectors cover major retailers plus generic schema.org markup;
  some heavily-JS-rendered sites may not be detected on the first try.
- Subscription detection is text-pattern based, so it can occasionally miss
  a subscription page or flag a false positive — manual add/edit always
  works as a fallback.
