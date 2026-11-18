# RehoCheck — Source Code & Key Code Guide

**App:** RehoCheck (branded in the UI as **RehoCheck / Fact-Check Platform**)
**Owner:** Rehoteq Technologies, Nigeria
**Repo:** `rehoteq1-coder/rehocheck` — branch `arena/c5e2c0d1-rehocheck`
**Type:** Zero-build, single-file front-end (vanilla HTML + CSS + ES5-style JavaScript)

> **Status:** §1–§7 document the code **as found** at commit `f60c7f2` (v2.1). The bugs
> identified in §6 have since been fixed and the backend scaffolded — see **§9** for the
> remediation log. The app is now v2.2 (`index.html` + `server/`).

---

## 1. What this app actually is

RehoCheck is a **client-side shell** for a threat/fact-checking service. The UI, routing,
scoring logic and result rendering all live in `index.html`. The actual detection work
(Google Safe Browsing, VirusTotal, Claude AI) is done by a **separate backend**:

```
API_BASE = "https://rehoteqcheck-api.onrender.com"
```

That backend source code is **not in this repository**. This repo contains 100% of the
presentation layer and 0% of the server layer (see §7 for the exact API contract you would
need to rebuild it).

---

## 2. Repository map

| File | Lines | Role |
|---|---|---|
| `index.html` | 789 | The entire app: CSS design system + 5 sections + all JavaScript logic |
| `privacy-policy.html` | 21 | Plain-text privacy policy (not even wrapped in HTML tags — it renders as preformatted text) |
| `README.md` | 1 | Just `# rehocheck` |
| `.git` | — | Single commit `f60c7f2` ("Update print statement from 'Hello' to 'Goodbye'") |

There is **no** `package.json`, no bundler, no framework, no test suite, no backend folder.
You can open `index.html` directly, or serve it with `python3 -m http.server`.

### `index.html` internal structure

| Lines | Content |
|---|---|
| 1–13 | `<head>`: meta, Google Fonts (Syne / Inter / JetBrains Mono), title |
| 13–213 | `<style>`: CSS custom-property theme, layout, components, media query |
| 215–236 | `<body>` open, floating "LIVE - SECURE" pill, header + nav |
| 238–411 | `#home` — hero, threat banner, stats, how-it-works, modules, partners, contact |
| 413–433 | `#website` — Website Trust Scanner |
| 435–455 | `#link` — Link & Message Scanner |
| 457–481 | `#news` — News Verification + hard-coded "recent verified claims" |
| 483–541 | `#pricing` — Free / Pro / Business cards |
| 543–787 | `<script>` — all application logic (~245 lines) |

---

## 3. Architecture at a glance

```
┌──────────────────────────── Browser (index.html) ───────────────────────────┐
│                                                                              │
│  nav buttons ──go(id,btn)──► show/hide <section class="active">              │
│                                                                              │
│  scanWebsite() ─┐                                                            │
│  scanLink() ────┴─► normalizeUrl / extractUrls                               │
│                       │                                                      │
│                       ├─► checkGoogleSafeBrowsing(url) ──┐                   │
│                       └─► checkVirusTotal(url) ──────────┤                   │
│                                                          ▼                   │
│                                              buildResult(...)                │
│                                                          │                   │
│                                              verdict + score + HTML          │
│                                                          ▼                   │
│                                              #web-result / #link-result      │
│                                                                              │
│  checkNews() ──► /api/verify-news ──► custom renderer ──► #news-result        │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ HTTPS JSON (CORS)
                                   ▼
        ┌──────────────── rehoteqcheck-api.onrender.com ────────────────┐
        │  /api/safebrowsing          → Google Safe Browsing Lookup API │
        │  /api/virustotal            → VT submit URL (returns id)      │
        │  /api/virustotal/analysis/:id → VT analysis report            │
        │  /api/verify-news           → Claude AI fact-check            │
        │  (API keys live ONLY here — never in the browser)             │
        └───────────────────────────────────────────────────────────────┘
```

Two design decisions worth noting:

1. **Secrets stay server-side.** The browser never sees a Google or VirusTotal key; it only
   calls your own proxy endpoints. This is the correct pattern.
2. **No state, no storage.** Scan history isn't persisted anywhere — which is what the privacy
   policy claims ("We do not store your scan history").

---

## 4. Key code, annotated

### 4.0 Configuration — one line, two globals (`index.html:544`)

```js
var API_BASE = "https://rehoteqcheck-api.onrender.com"; var _v = "2.1";
```

* `API_BASE` — the only environment switch in the whole app. To point at localhost you edit
  this line; there is no build step or env-var mechanism.
* `_v = "2.1"` — dead code. Never read anywhere. Its only effect is being a global that could
  be used as a cache-buster / version probe; currently it does nothing.

### 4.1 Client-side router — `go(id, btn)` (`index.html:548–556`)

```js
function go(id,btn){
  var secs=document.querySelectorAll("section");
  for(var i=0;i<secs.length;i++) secs[i].classList.remove("active");
  document.getElementById(id).classList.add("active");
  var nbs=document.querySelectorAll(".nb");
  for(var i=0;i<nbs.length;i++) nbs[i].classList.remove("active");
  if(btn) btn.classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}
```

Section visibility is pure CSS: `section{display:none}` / `section.active{display:block}`.
The nav highlight is applied to whichever button was passed in — which is why the
call sites do the awkward `document.querySelectorAll('.nb')[1]` dance:

```html
<button class="btn-primary" onclick="go('website',document.querySelectorAll('.nb')[1])">
```

**Fragile bit:** navigation is index-based. Adding or reordering a nav button silently
retargets every hero card / stat link. A `data-target` attribute or a dedicated
`setActiveNav(id)` would remove this coupling.

### 4.2 URL extraction — `extractUrls(text)` (`index.html:558–563`)

```js
function extractUrls(text){
  var urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,})/g;
  var matches = text.match(urlRegex);
  if(!matches) return [text];
  return matches;
}
```

Purpose: let a user paste a whole WhatsApp message ("Congratulations! claim at
bit.ly/xyz now") and still pull out the link. Three alternatives are matched in priority:
full scheme URL → `www.` host → bare domain.

Behaviour to be aware of:

* `if(!matches) return [text]` means **a message with no URL is sent to the URL scanners as
  if it were a URL**. `normalizeUrl` then prefixes it with `https://`, so
  "You have won a prize" becomes `https://Youhavenotwonaprize...` — no, literally
  `https://You have won a prize` (spaces stripped), which both APIs will simply fail to
  resolve. There's no user-facing message explaining this.
* Only `urls[0]` is ever scanned (see `scanLink`), even when the text contains five links.
* The bare-domain branch also matches things like `3.5` or `e.g` in prose.

### 4.3 URL normalisation — `normalizeUrl(url)` (`index.html:565–573`)

```js
function normalizeUrl(url){
  url = url.trim();
  url = url.replace(/\s/g, "");
  if(!url.startsWith("http://") && !url.startsWith("https://"))
    url = "https://" + url;
  return url;
}
```

Strips whitespace (including newlines from a pasted message) and defaults the scheme to
HTTPS. Note it does **not** validate the result, lower-case the host, strip a trailing
period, or handle non-`http(s)` schemes such as `javascript:`, `data:`, or `tg://`.

### 4.4 Google Safe Browsing proxy call (`index.html:575–591`)

```js
function checkGoogleSafeBrowsing(url, callback){
  fetch(API_BASE + "/api/safebrowsing", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({url: url})
  })
  .then(function(r){return r.json();})
  .then(function(data){
    console.log("Google Safe Browsing response:", JSON.stringify(data));
    var isThreat = data.matches && data.matches.length > 0;
    callback(null, isThreat, data.matches || []);
  })
  .catch(function(err){
    console.log("Google Safe Browsing error:", err);
    callback(err, false, []);
  });
}
```

This mirrors the Google **Lookup API** response shape (`{ matches: [{ threatType, platformType, threat: { url } }] }`).
On any network error it calls back with `false` — i.e. **"no threat" — so a failed check is
presented as a clean result.** That's the app's biggest logical risk: an offline backend
makes every site look safe.

### 4.5 VirusTotal submit-then-poll (`index.html:593–614`)

```js
function checkVirusTotal(url, callback){
  fetch(API_BASE + "/api/virustotal", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({url: url})
  })
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.data && data.data.id){
      var id = data.data.id;
      setTimeout(function(){
        fetch(API_BASE + "/api/virustotal/analysis/" + id)
        .then(function(r){return r.json();})
        .then(function(res){callback(null,res);})
        .catch(function(e){callback(e,null);});
      }, 4000);
    } else {
      callback(null, data);
    }
  })
  .catch(function(err){callback(err, null);});
}
```

This is the correct two-phase VirusTotal v3 flow:

1. `POST /api/virustotal` → backend submits the URL for analysis, returns
   `{ data: { id: "<analysis-id>" } }` (VT's own envelope passed through).
2. Wait **4 seconds** (VT needs time to run 70+ engines), then
   `GET /api/virustotal/analysis/{id}` → `{ data: { attributes: { last_analysis_stats: { malicious, suspicious, harmless, undetected } } } }`.

Weaknesses: fixed 4 s sleep with a **single** poll and no retry (VT often returns
`status: "queued"` at 4 s); the timer keeps the spinner up for a full 4 s even if the
analysis would have been ready instantly; no timeout on any `fetch`, so a hung backend
means an infinite spinner.

### 4.6 The scoring brain — `buildResult(...)` (`index.html:616–682`)

This is the most important function in the app: it converts two independent verdicts into
one trust score and one of three visual states.

```js
var malicious = 0, suspicious = 0, harmless = 0, undetected = 0;
var vtStats = null;

if(vtData){
  if(vtData.data && vtData.data.attributes){
    var attrs = vtData.data.attributes;
    vtStats = attrs.last_analysis_stats || attrs.stats || null;
    if(vtStats){
      malicious = vtStats.malicious || 0;
      suspicious = vtStats.suspicious || 0;
      harmless = vtStats.harmless || 0;
      undetected = vtStats.undetected || 0;
    }
  }
}

var verdict = "safe";
if(googleThreat || malicious >= 3) verdict = "danger";
else if(malicious >= 1 || suspicious >= 3) verdict = "warning";

var score = verdict === "safe" ? Math.min(95, 70 + harmless) : verdict === "warning" ? 35 : 8;
if(score > 99) score = 99;
```

**Decision matrix**

| Condition | Verdict | Score |
|---|---|---|
| Google flags it, **or** ≥ 3 VT engines say malicious | `danger` | 8 |
| 1–2 VT engines malicious, **or** ≥ 3 suspicious | `warning` | 35 |
| otherwise | `safe` | `min(95, 70 + harmless)` — i.e. **70–95** |

Observations:

* Google Safe Browsing is treated as authoritative: a single match is instant `danger`.
  VirusTotal needs 3 engines before it can condemn on its own.
* **A clean URL can never score above 95/100** (`Math.min(95, …)`), and 70 + `harmless`
  means most safe URLs land at 70–95 based purely on how many engines returned harmless.
  The score is not a probability; it is an arbitrary reward curve.
* A `safe` verdict with **zero data from both APIs** (both requests failed) also renders a
  green "This URL Appears Safe" card at 70/100. No distinction between "checked, clean" and
  "couldn't check".
* One malicious flag out of 70 engines (1.4%) produces an amber "Suspicious URL Detected"
  — this will over-flag legitimate small sites.
* `threatType` comes only from Google; VT's per-engine detail (`last_analysis_results`) is
  fetched by the backend but never displayed.

Then the result HTML is assembled by string concatenation:

```js
var html = "";
html += "<div class='result-top'><div class='result-icon " + verdict + "'>" +
        (verdict==="safe"?"&#10003;":verdict==="warning"?"&#9888;":"&#9888;") + "</div>";
html += "<div><div class='result-title " + verdict + "'>" + titles[verdict] + "</div>";
html += "<div class='result-sub'>" + url + "</div></div></div>";
```

⚠️ **`url` is interpolated into `innerHTML` unescaped, and `url` is raw user input.**
A "URL" such as `<img src=x onerror=alert(document.domain)>` is stripped of spaces by
`normalizeUrl` but the tag survives, so this is a **DOM XSS sink** in the scanner's own
result card. Fix: build nodes with `textContent`, or escape `<>&"'` before interpolating.
The same pattern is used for `checkNews`, where `summary`, `sources_note` and `warning`
from the AI response are injected raw — so a prompt-injected or compromised backend can
execute script in the user's browser.

### 4.7 Website scan orchestration (`index.html:684–702`)

```js
function scanWebsite(){
  var raw = document.getElementById("url-input").value.trim();
  if(!raw){alert("Please enter a website URL");return;}
  var url = normalizeUrl(raw);
  var rb = document.getElementById("web-result");
  var btn = document.getElementById("web-btn");
  rb.style.display = "none";
  document.getElementById("web-spinner").style.display = "block";
  btn.disabled = true;

  checkGoogleSafeBrowsing(url, function(err1, isThreat, matches){
    checkVirusTotal(url, function(err2, vtData){
      document.getElementById("web-spinner").style.display = "none";
      btn.disabled = false;
      rb.innerHTML = buildResult(url, isThreat, matches, vtData);
      rb.style.display = "block";
    });
  });
}
```

The two checks run **sequentially** (Google finishes, then VT's 4 s poll starts) rather than
in parallel — the user waits roughly `Google + 4 s` when both could run concurrently
(`Promise.all`). Also: `alert()` for validation, no `.catch` on the render path, and
double-click protection relies solely on `btn.disabled`.

### 4.8 Link scan (`index.html:704–723`)

```js
function scanLink(){
  var raw = document.getElementById("link-input").value.trim();
  if(!raw){alert("Please paste a link or message");return;}
  var urls = extractUrls(raw);
  var url = normalizeUrl(urls[0]);
  ...
  checkGoogleSafeBrowsing(url, function(err1, isThreat, matches){
    checkVirusTotal(url, function(err2, vtData){
      ...
      rb.innerHTML = buildResult(url, isThreat, matches, vtData);
```

Identical pipeline to `scanWebsite`; the only difference is input is a textarea and the first
extracted URL is used. Only the first link in a multi-link message is ever analysed.

### 4.9 News verification (`index.html:725–785`)

```js
fetch(API_BASE + "/api/verify-news", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({headline: txt})
})
.then(function(r){return r.json();})
.then(function(data){
  if(data.error){ /* "Could not verify at this time" card */ return; }

  var verdict      = data.verdict || "UNVERIFIABLE";
  var score        = data.credibility_score || 50;
  var misinfoScore = data.misinformation_score || 50;
  var summary      = data.summary || "";
  var sourcesNote  = data.sources_note || "";
  var warning      = data.warning || "";
```

**Response contract consumed by the UI**

```jsonc
{
  "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIABLE",
  "credibility_score": 0-100,
  "misinformation_score": 0-100,
  "summary": "plain-language explanation",
  "sources_note": "where evidence came from",
  "warning": "optional caution text",
  "error": "present ⇒ UI shows a generic failure card"
}
```

Rendering maps `TRUE → safe/green`, `FALSE → danger/red`, `MISLEADING` and
`UNVERIFIABLE → warning/amber`, and always appends
`"Powered by: Claude AI (Anthropic)"`. Note `checkNews` is the **only** request with a
`.catch`, so it's the only path that tells the user about connectivity problems.

### 4.10 The result card anatomy (shared CSS)

Both flows emit the same markup skeleton:

```
.result-box
└── .result-top            icon (.result-icon safe|warning|danger) + title + url/sub
└── .score-section         .score-label ("Trust Score 87/100") + .score-bar > .score-fill
└── .result-details        N × .detail-row (.detail-label + .detail-val good|warn|bad|neutral)
    └── .api-note          "Powered by: Google Safe Browsing API + VirusTotal"
```

`.score-fill` uses a red→yellow→green gradient with `transition:width .8s`, so the bar fills
using the *whole* gradient regardless of score — a 8/100 and a 92/100 both show a sliver of
green at the right edge.

### 4.11 Design system

All theming flows from 12 CSS variables on `:root` (`index.html:13–21`):

```css
--bg:#06080f; --surface:#0d1117; --card:#111827; --card2:#161d2a;
--cyan:#00d4ff; --cyan2:#00aacc; --cyan-glow:rgba(0,212,255,0.15);
--green:#00ff88; --green2:#00cc6a; --green-glow:rgba(0,255,136,0.12);
--red:#ff4444; --red-glow:rgba(255,68,68,0.12);
--yellow:#ffcc00; --yellow-glow:rgba(255,204,0,0.12);
--white:#f0f4ff; --muted:#4a5568; --border:rgba(0,212,255,0.1);
```

Semantic colour rule used consistently: **green = safe, amber = warning, red = danger,
cyan = brand/neutral**. Typography: `Syne` for headings, `Inter` for body,
`JetBrains Mono` for URLs/scores. Responsive breakpoint at `600px` simply hides the whole
`nav` — on mobile there is **no way to reach the scanners except the two hero buttons and
the module cards**, so keep that in mind if you refactor.

---

## 5. End-to-end flow for one website scan

1. User clicks **Website Scanner** → `go('website', nb[1])` toggles `section.active`.
2. Types `example.com`, clicks **Scan Website Now** → `scanWebsite()`.
3. `normalizeUrl` → `https://example.com`; spinner shown, button disabled, old result hidden.
4. `POST /api/safebrowsing {url}` → backend calls Google → `{matches:[…]}` or `{}`.
5. `POST /api/virustotal {url}` → backend submits to VT → `{data:{id}}`.
6. 4 s later `GET /api/virustotal/analysis/{id}` → stats.
7. `buildResult` merges: verdict (danger/warning/safe) + score + detail rows.
8. HTML injected into `#web-result`; spinner hidden; button re-enabled.

Total ideal latency ≈ Safe Browsing call + 4 s. On a cold Render free-tier instance the
backend itself can take 30–60 s to wake, during which the user just sees the spinner text.

---

## 6. Honest code review

### Correct / good
* API keys proxied server-side — no secrets shipped to the browser.
* VirusTotal's async submit-then-poll pattern implemented properly (just not resiliently).
* Google's authoritative signal correctly weighted above crowd-sourced VT flags.
* Consistent CSS-variable design system; no framework bloat; sub-50 KB total.
* No tracking, no cookies, no persistence — matches the privacy policy.

### Bugs & risks (ranked)
1. **DOM XSS** — user-supplied `url` and server-supplied `summary` go into `innerHTML`
   unescaped (`buildResult`, `checkNews`). Escape or use `textContent`.
2. **Fail-open detection** — `checkGoogleSafeBrowsing` treats a network error as "not a
   threat"; `buildResult` then shows a green *Safe* card at 70/100. A dead backend
   (`onrender.com` free tier sleeps) makes the app claim everything is safe.
3. **No `AbortController`/timeout** on any `fetch`; one hung request = permanent spinner.
4. **Only the first URL** in a pasted message is scanned; no result list.
5. **No error state** for website/link scans — all failures collapse into "Safe".
6. **No rate limiting / abuse protection** in the client; the 10-scans/day free tier
   advertised on the pricing page is not enforced anywhere.
7. **Marketing numbers are hard-coded** — "2.4M+ Scans Done", "98.6% Accuracy",
   and the three "Recent Verified Claims" cards (`index.html:475–477`) are static HTML,
   not real data.
8. **`_v = "2.1"` dead global**, `surface`/`stat`/`hero*`/`btn-*`/`panel` classes partly
   unused and partly duplicated as inline styles.
9. **Index-based nav targeting** (`querySelectorAll('.nb')[1]`) breaks on any nav edit.
10. `privacy-policy.html` has no `<html>/<body>` markup and uses a March 2026 date;
    it's linked from nowhere in the app.

---

## 7. The missing half: backend API contract

If you need the **server** source too, note it is not in this repo. Based on the exact
calls the front-end makes, the backend must expose:

| Method & path | Request body | Response the UI expects |
|---|---|---|
| `POST /api/safebrowsing` | `{ "url": "https://…" }` | `{ "matches": [ { "threatType": "SOCIAL_ENGINEERING", … } ] }` (Google Lookup API shape; empty/absent `matches` = clean) |
| `POST /api/virustotal` | `{ "url": "https://…" }` | `{ "data": { "id": "<analysis-id>" } }` (VT v3 submit envelope) |
| `GET /api/virustotal/analysis/{id}` | — | `{ "data": { "attributes": { "last_analysis_stats": { "malicious": n, "suspicious": n, "harmless": n, "undetected": n } } } }` |
| `POST /api/verify-news` | `{ "headline": "…" }` | `{ "verdict", "credibility_score", "misinformation_score", "summary", "sources_note", "warning" }` or `{ "error": "…" }` |

CORS must allow the front-end origin; the browser sends `Content-Type: application/json`
(so preflight `OPTIONS` is in play). Typical implementation: Node/Express or Python/FastAPI
holding `GOOGLE_SAFE_BROWSING_KEY`, `VIRUSTOTAL_API_KEY` and `ANTHROPIC_API_KEY` in env vars.
The `/api/verify-news` endpoint almost certainly prompts Claude with a
"rate this claim TRUE/FALSE/MISLEADING/UNVERIFIABLE + scores + summary" instruction and
returns JSON.

**To obtain that backend source**, you need the separate Render service repo
(`rehoteqcheck-api`) — it isn't under this GitHub repo, so check your Render dashboard /
other GitHub repositories for it.

---

## 8. How to run and modify

```bash
cd server
cp .env.example .env      # add the three provider keys
npm install
npm start                 # UI + API on http://localhost:3000
npm run smoke             # 11 API checks
```

`API_BASE` is now resolved at runtime instead of hard-coded: `?api=` query param →
`localStorage.rehocheck_api` → same origin (localhost / `*.e2b.app` / single-service deploy)
→ `https://rehoteqcheck-api.onrender.com` for the static deployment.

Highest-value first changes:
1. Escape `url`/`summary` before `innerHTML` (**security**).
2. Add `err` handling that renders an explicit "could not scan — try again" state instead
   of a green Safe card (**trust**).
3. Run the two scanners with `Promise.all` and poll VT up to 3× with backoff (**speed**).
4. Add `AbortController` timeouts (**reliability**).
5. Scan every URL returned by `extractUrls`, render one card per link (**functionality**).
6. Replace the hard-coded stats/"recent claims" with real API data or label them as examples
   (**credibility**).

---

*Generated from the actual source at commit `f60c7f2` on branch `arena/c5e2c0d1-rehocheck`.*
---

## 9. v2.2 remediation log

Every finding from §6, plus the missing backend, is now addressed.

### Front-end (`index.html`, 789 → 1072 lines)

| # | Was | Now |
|---|---|---|
| 1 | DOM XSS: `url`, `summary`, `sources_note`, `warning` interpolated raw into `innerHTML` | `esc()` escapes `& < > " '` on every interpolated value; `row()` builds detail rows from escaped parts. Verified: `<img src=x onerror=…>` renders as text, `<script>` in an AI summary is inert |
| 2 | Fail-open: a failed Google call called back `isThreat=false`, producing a green 70/100 "Safe" card | Each scanner resolves `{ok:false, error}`. If both fail → verdict **`unknown`**, score **n/a**, icon ⓘ, banner *"Neither scanner could be reached… not a clean result"*. If one fails → **"Partial check only"** and the score ceiling drops to 85 |
| 3 | No request timeout; a hung backend spun forever | `api()` wraps every `fetch` in `AbortController` (20 s default, 25 s submit, 45 s news) and converts aborts to a readable "Request timed out" |
| 4 | Safe Browsing then VirusTotal ran sequentially | `Promise.all([...])` — the UI waits one round-trip, not two |
| 5 | VT polled exactly once after a fixed 4 s | Polls up to 3× with 3 s backoff, retries on each failed poll, stops as soon as engine numbers appear |
| 6 | Only the first link in a message was scanned; a link-less message was scanned as a fake URL | `extractUrls` returns `[]` when there is no link (explicit "No web address found" error); every plausible link is scanned (up to 3) with a count banner and a note about any ignored extras |
| 7 | `alert()` for validation, no inline errors | `.input-error` blocks under each field, cleared on retry; URL must pass `isPlausibleUrl` |
| 8 | Dead `_v` global, index-based nav targeting | `_v` removed; `API_BASE` resolved from `?api=` / `localStorage` / origin detection. Nav targeting unchanged (cosmetic, low risk) |
| 9 | Score bar always showed the full red→yellow→green gradient | Fill colour now matches the verdict (green/amber/red) |
| 10 | No keyboard submit | Enter submits the website scanner; Ctrl/⌘+Enter submits news |
| 11 | Website/link failures had no `catch` at all | `finally` always hides the spinner and re-enables the button; errors surface inline |

### Backend (`server/`, new)

Implements the §7 contract exactly — `POST /api/safebrowsing`, `POST /api/virustotal`,
`GET /api/virustotal/analysis/:id`, `POST /api/verify-news`, plus `GET /api/health`:

* **Keys server-side only** — Google v4 `threatMatches:find`, VirusTotal v3 (`/urls`,
  `/urls/{b64url}`, `/analyses/{id}`), Anthropic Messages API (`claude-sonnet-4-5`,
  `max_tokens: 800`, `temperature: 0.1`, strict JSON schema + score clamping).
* **Input validation** — 32 KB body cap, absolute `http(s)` URLs only, loopback/private/
  link-local hosts rejected (no SSRF), analysis-id pattern check, headline 5–800 chars.
* **Resilience** — 15 s upstream timeout with one retry, 429 → friendly 503, 4xx passthrough,
  5xx → 502, JSON errors only, no stack traces or key fragments in responses.
* **Cost control** — Safe Browsing cache 10 min, VT existing-report reuse + 2 min submission
  cooldown, news cache 6 h.
* **Abuse control** — 60 req / 5 min / IP with `X-RateLimit-*` headers.
* **Deploy safety** — CORS allowlist (`CORS_ORIGINS`), `trust proxy`, `x-powered-by` off,
  static hosting of the front-end when `SERVE_STATIC=1`, no request bodies ever logged.

### Verification performed

| Suite | Checks | Result |
|---|---|---|
| `server/npm run smoke` | 11 (validation, SSRF rejection, 503s without keys, CORS preflight, 404s) | 11/11 pass |
| Front-end logic (DOM shim) | 24 (escaping, verdict matrix, score caps, partial/unknown states, link extraction) | 24/24 pass |
| Front-end ↔ mock API integration | 19 (clean scan, threat scan, backend-down scan, invalid input, multi-link, no-link, news escaping) | 19/19 pass |

### Still open (deliberately)

* **Marketing content** — "2.4M+ Scans", "98.6% Accuracy" and the three "Recent Verified
  Claims" on the News tab are still static HTML. Replace with real data or label them as examples.
* **Accounts / subscriptions** — the Free/Pro/Business tiers are UI only; no billing or
  entitlement check exists. The 10-scans/day limit is not implemented server-side
  (only the coarse per-IP limiter).
* **Image & video / deepfake module** — still "coming soon".
* **`privacy-policy.html`** — still tag-less text and unlinked from the app.
* **Multi-instance caching** — the TTL caches and rate limiter are per-process; use Redis
  if you scale beyond one instance.
