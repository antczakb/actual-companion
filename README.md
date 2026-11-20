# Actual companion

A small web app that sits beside your Actual Budget server and reads it through Actual's official API. It does not modify Actual's code, so Actual upgrades do not break it. Everything runs on your own server; nothing is sent anywhere except to Actual, SimpleFIN and SnapTrade.

| Tab | What it does |
|---|---|
| **Loan** | Projects cash from your Actual balances and spending, adds planned purchases, and sizes the smallest loan that keeps cash above your reserve floor (HELOC, home equity loan, personal loan). Same rule as the workbook's Loan_Planner. |
| **Budget** | Suggests a monthly amount per category from your last 12 months, compares it with the current month's budget, and gives the matching Actual `#template` line. Report only; it never changes your budget. |
| **Investments** | Pulls balances and holdings from SnapTrade into snapshots kept by this app (not in Actual's ledger) and charts the total over time. |
| **SimpleFIN** | Shows every field SimpleFIN sends, as tables (accounts and transactions), so you can see what detail exists. |
| **Venmo** | Upload a Venmo statement CSV; matches each payment to the bank's "VENMO PAYMENT" row and proposes the real payee, note and category. Nothing is written until you press Apply. |
| **Settings button** (top right of each tab) | That tab's options as a form: cash accounts and growth (Loan), tolerances (Budget), match window and keywords (Venmo), fetch window (SimpleFIN). |

## What was tested, and what was not

Tested (34 automated tests, `npm test`, no network needed): loan sizing checked against an independent month-by-month amortization schedule; projection and cash-flow math; budget suggestions; Venmo CSV parsing and matching; SimpleFIN client against a local mock server; snapshots; request handling, login and file serving.

**Not tested against the real services**, because they were not reachable from where this was built:

1. The calls to `@actual-app/api` (`src/adapters/actual.js`).
2. The calls to the SnapTrade SDK (`src/adapters/snaptrade.js`).
3. A real SimpleFIN response and a real Venmo statement. The parsers follow the documented formats and tolerate extra columns, but your files are the real test.

All real-service code is in those two adapter files and nowhere else, so if a call differs in your version, the fix is small and local. Run the first-run checks below before trusting any number.

## Deploy

1. **Copy the folder** to the machine that runs your Actual server (or any machine that can reach it).
2. `cp .env.example .env` and fill it in:
   - `ACTUAL_SERVER_URL`: the address of your Actual server as seen from this container. If both run in Docker on one host, use the other service's name (for example `http://actual_server:5006`) on a shared network, or the host's LAN address.
   - `ACTUAL_SYNC_ID`: in Actual, Settings, Show advanced settings, Sync ID.
   - `ACTUAL_API_VERSION`: your Actual server's version, so the API library matches it.
   - `APP_PASSWORD`: choose something long. The app refuses to start without one.
   - `SIMPLEFIN_ACCESS_URL`: the Access URL your Power Query already uses.
3. `docker compose up -d --build`
4. Open `http://<server>:3000`, sign in with any username and your `APP_PASSWORD`.
5. Keep it on your home network. The login is plain HTTP basic auth, so do not expose port 3000 to the internet; if you want remote access, put it behind a reverse proxy with HTTPS or a VPN.
6. The `data/` folder holds settings, cached SimpleFIN data, investment snapshots and a local copy of your budget. Treat it like the budget itself.

To preview the screens with made-up data first and no credentials: `node scripts/demo.js` (needs Node 20+), then open `http://127.0.0.1:3100`.

### Proxmox LXC (no Docker)

`deploy/install-lxc.sh` creates an unprivileged Debian 12 container, installs Node.js 22 from NodeSource's apt repository, installs the app as a systemd service running as an unprivileged user, and generates a sign-in password. Run it as root on the Proxmox node, with `actual_companion.zip` next to it:

```
./install-lxc.sh -s local-lvm -a 192.168.1.50/24,gw=192.168.1.1 -v <your Actual version>
```

Options: `-i` container ID (default next free), `-n` hostname, `-s` storage for the disk, `-t` template storage, `-b` bridge, `-a` `dhcp` or a static address, `-m` memory in MB (512), `-d` disk in GB (4), `-z` path to the zip, `-v` Actual API version. Then edit `/etc/actual-companion.env` inside the container (`pct exec <id> -- nano /etc/actual-companion.env`), restart the service, and add an NPMplus proxy host to `http://<container-ip>:3000` with HTTPS and an access list limited to your LAN. To upgrade: `./install-lxc.sh update <id> -z new.zip` (settings and data are kept).

The script was tested only against stand-in `pct`/`pveam` commands (argument flow, update and error paths), not on a real Proxmox host. Read it before running it; it is short.

### Without Docker

Node 20+ and `npm install`, set the same variables in your shell, then `npm start`.

## First-run checks (about 15 minutes)

1. **Status line** at the top right should say Actual configured. If a tab shows an error, it is usually the Sync ID, the password, or an API version that does not match the server.
2. **Loan tab, "based on N months"** should match how much history you imported (25 months for you). Cash today should equal your on-budget account balances. If it is off, open Settings on the Loan tab and tick the accounts you count as cash.
3. **Loan tab:** pick your house and mortgage accounts (or type values), enter your real loan quotes and planned purchases in steps 1 to 3. Until then the page warns you.
4. **Compare one number with the workbook:** use the same inputs and the Loan_Planner's suggested loan should agree. If it does not, tell me both sets of inputs.
5. **SimpleFIN tab:** look at the columns for your Venmo-related transactions. Anything beyond `description` is new information.
6. **Budget tab:** check that "uncategorized" is small. Uncategorized spending is left out of the suggestions, and counted as spending in the loan projection.

## Venmo, month by month

1. venmo.com, Statements, pick the month, Download CSV.
2. Venmo tab, choose the file, Preview matches.
3. Review: each row shows what the bank says, the payee and note that would be set, and a category (from your past payments to that person, or from keywords in the note, or the category it already has). Change any category in the dropdown, untick rows you do not want.
4. Apply selected to Actual.

Notes: matches need the same amount and a date within `venmo.dayWindow` days (default 5, for ACH delay). Each updated bank row gets a marker like `[venmo:12345]` in its notes so a second run never touches it twice. Payments made from your Venmo balance have no bank row; they are listed separately. Add keyword rules in the Venmo tab's Settings, for example the word "rent" with the category "Housing: Rent". Use the category's exact name as it appears in Actual. If your Actual setup already has a rule that renames "VENMO" payees, applying a row replaces that payee with the person's name.

## SnapTrade

1. Create a free personal account at SnapTrade and put your client ID and consumer key in `.env`.
2. Investments tab, **Connect a brokerage**, finish the login in the page that opens, then **Refresh from SnapTrade**.
3. Check that your brokerages are on SnapTrade's supported list before relying on it.

## Troubleshooting

- **"Could not reach the Actual server"** (the log says `network-failure`): the container cannot connect to `ACTUAL_SERVER_URL`. From the Proxmox node run `pct exec <id> -- curl -sI <that URL>`. You should get an HTTP status line. Use the Actual server's LAN address and port (for example `http://192.168.1.10:5006`), with `http` or `https` matching how it is served. Restart the service after editing `/etc/actual-companion.env`.
- **"Authentication failed" with a different reason**: wrong `ACTUAL_PASSWORD`.
- **SnapTrade errors**: the message now includes the HTTP status and SnapTrade's reply. On the Investments tab, "Show response shape" prints the structure of SnapTrade's replies (key names and types only, no balances or names) so a parsing problem can be diagnosed without sharing your data.
- **SnapTrade holdings**: SnapTrade's `getUserHoldings` is deprecated and returns 410 for accounts created after May 11, 2026. The app uses the positions and balances calls and falls back to the old one only when those are missing.

## Known limits

- Budget suggestions do not read Actual's schedules yet, so scheduled bills get an average-based suggestion, not a `schedule` template.
- Split transactions use the split lines' categories; the parent is ignored.
- Transfers between on-budget accounts are ignored. Transfers to off-budget accounts (brokerage, loan) count as money leaving cash.
- The loan model does not include interest on loan proceeds, rate changes on a variable-rate HELOC, or taxes. Rates and fees are placeholders until you enter real quotes.
- SimpleFIN limits how often it can be pulled, so results are cached for `simplefin.cacheHours` (default 6); use "Fetch fresh" sparingly.
- The projection holds income and spending flat (optional yearly growth in the Loan tab's Settings) and treats planned purchases as one-time.

### Cannot reach the Actual server

Use **Settings > Test connection to Actual** (the Settings button at the top of the Loan, Budget or Venmo tab): it reports whether the problem is DNS, a refused port, a timeout (firewall), a wrong http/https, or an untrusted certificate. From the container shell, `curl -sI` hides errors; use `curl -v --max-time 8 http://IP:5006` instead. For an internal/self-signed certificate behind NPMplus, copy the CA into the container and add `NODE_EXTRA_CA_CERTS=/path/ca.pem` to `/etc/actual-companion.env`, or point `ACTUAL_SERVER_URL` at `http://IP:5006` directly.

### Trusting the Actual certificate

If Actual itself serves HTTPS with its own certificate (a plain `http://` request gets "Empty reply from server"), use `https://IP:5006` and either:

1. **Trust it (preferred).** In the container:
   `openssl s_client -connect 192.168.0.238:5006 </dev/null 2>/dev/null | openssl x509 > /etc/actual-companion-ca.pem`
   then add `NODE_EXTRA_CA_CERTS=/etc/actual-companion-ca.pem` to `/etc/actual-companion.env` and `systemctl restart actual-companion`. The certificate must list the host name or IP you use in `ACTUAL_SERVER_URL`.
2. **Skip verification (LAN only).** Add `ACTUAL_INSECURE_TLS=1` to `/etc/actual-companion.env`. This turns off certificate checking for every outbound HTTPS call the app makes, including SimpleFIN and SnapTrade, so use it only until you have done option 1.

### Loan planner: Actual accounts and saved scenarios

- In step 2, home value, mortgage and other liens can each come from an Actual account (its current balance; debts show as a positive amount owed) or a custom value. Accounts named like "House" or "Mortgage" are pre-selected the first time.
- **Save scenario** stores your inputs and the result under a name (`scenarios.json` in the data folder). **View** shows the result as saved, **Load** puts the inputs back in the planner, and ticking two or more then **Compare selected** shows them side by side.

### Payoff strategies

Under the loan details, the app lists ways to pay the loan off early: fixed payments that clear it in 2, 3, 5, 7, 10 or 15 years (only those shorter than the loan's full term), plus the fastest payment that fits. A strategy is "within budget" when its payment is at most the share of monthly surplus you set in step 2 (default 50%) **and** cash stays above your floor through the look-ahead window. The ★ row is the cheapest one that fits.

## Nightly snapshot and tracked assets (v0.1.14)

- The server takes one snapshot a day at the time set in Invest > Settings (default 23:55, **server clock**). It records SnapTrade balances and, for any asset linked to an Actual account, that account's balance. If the container is off at that time, that day is skipped. Check the time zone with `date`; fix it with `timedatectl set-timezone America/New_York`. Disable the timer entirely with `DISABLE_SCHEDULER=1`.
- The Assets tab tracks a home, vehicles and a camper as dated values (`assets.json` in the data directory). There is no automatic price lookup (Zillow, KBB and similar do not offer a free personal API), so enter a value whenever you look one up, or link the asset to an Actual account you keep updated. Values older than 90 days are flagged.

## Amazon order detail (v0.1.15)

Amazon has no personal API. Request your data from Amazon (Account > Request My Data > Your Orders), unzip, and upload `Retail.OrderHistory.1.csv` in the Amazon tab. Each order (or each shipment, since Amazon bills per shipment) is matched to a bank charge by exact amount within the date window. Applying adds the item names to the transaction notes with an `[amzn:ORDER]` marker (so a re-run skips it) and sets a category from your item keywords. Columns are found by name; if a file is not recognized the error lists the column names it saw.

## Home and vehicle values from changedetection.io (v0.1.16)

1. In changedetection.io, add a watch for the page that shows the value (your county assessor page, a Redfin or Zillow estimate page, a KBB or dealer value page). If the number is rendered by JavaScript, set the watch's fetch method to a browser (Chrome/Playwright). Use a CSS selector or "Extract text" filter so the snapshot contains just the value; check it in the watch's Preview tab.
2. In changedetection.io Settings > API, copy the API key. On the companion server add to `/etc/actual-companion.env`: `CHANGEDETECTION_URL=http://<host>:5000` and `CHANGEDETECTION_API_KEY=...`, then `systemctl restart actual-companion`.
3. In the Assets tab, edit the asset and paste the watch's UUID or edit URL. Each night the app reads the latest snapshot and records the first dollar amount in it (or the first group of your optional pattern). "Fetch now" tests it immediately.
4. A reading more than 25% away from the last value is not saved; it shows as a warning on the asset so a mis-scrape cannot rewrite your history.

Note: Zillow, Redfin and KBB often block automated visitors and their terms restrict scraping, so a watch on those sites may fail or return a challenge page. A county assessor page is the most reliable for a house; a dealer or marketplace listing for a similar vehicle works for cars.

## Job loss stress test and existing-loan payoff (v0.1.17)

- **Existing loans to pay off** (Loan tab): balance (Actual account or typed), rate, monthly payment and the month you would pay it off. The payoff amount is computed from the rate and payment unless you enter one. It leaves cash in that month (which can change the size of a new loan you need) and, from then on, the monthly payment stops. "In spending?" says whether that payment is already part of the spending Actual averages; if not, no saving is counted.
- **Job loss stress test**: from a start month, only the share of income you enter keeps coming in, spending is cut by your percentage, investing can pause, bonuses stop and severance lands in the first month. The results show the lowest cash, when cash runs out, and months under your reserve, with and without the loan you are looking at.

## Value estimates without scraping (v0.1.18)

In the Assets tab, edit an asset and choose **Estimate automatically**:

- **House price index (FRED):** enter a value you trust (an appraisal, a purchase price, a recent estimate), its date, and a FRED series ID. The app scales your value by how the index has moved since then. FHFA publishes free all-transactions house price indexes by state (for example `NCSTHPI`) and by metro area; `USSTHPI` is the US average. Get a free API key at fredaccount.stlouisfed.org and set `FRED_API_KEY` in `/etc/actual-companion.env`. Indexes update quarterly and are about two months behind.
- **Depreciation:** enter a known value, its date and a yearly percentage (cars often 10-15%, campers 8-10%). It ignores mileage and condition.

The nightly job refreshes an estimate when the last one is a week old; "Estimate now" does it immediately. When you enter a real quote by hand, enter a new starting value as well so the estimate restarts from it.

## Version, reminders, chart hover (v0.1.19)

- The version shows at the top right of every page.
- **Monthly value reminder:** a banner appears from the reminder day (Assets > Settings, default the 1st) for each home, vehicle or camper you have not updated by hand this month. Each asset card has quick links (Zillow and Redfin for a home, Kelley Blue Book for a vehicle) or one link you paste for your exact page. Assets linked to an Actual account are never flagged; an estimate does not count as updating. For a push as well, set `NOTIFY_URL` in `/etc/actual-companion.env` to an ntfy topic URL (or any service that accepts a plain-text POST); it is sent on the reminder day and every 7 days while something is still due.
- Hover or tap any chart to see the values of every line at that point.
- Hovering the Invest or Assets tab for about a second and a half shows how those tabs fit with Actual; each of those tabs also has the same text under a collapsible heading.

## v0.1.20: Net worth tab and Invest stock dashboard

- **Net worth tab**: SimpleFIN balances for all your accounts are saved every night (and on "Refresh from SimpleFIN"). Each account gets a type (cash, investment, credit card, loan, other asset, ignore); the app guesses, you correct. Credit cards and loans always count as debts. Home, vehicle and camper values from the Assets tab are added. Mark any account that mirrors your house or a vehicle as Ignore to avoid double counting. Nothing is written to Actual.
- **Invest tab** is now a stock dashboard for SnapTrade-linked brokerages: positions with share of portfolio, click a symbol for its value history, and a Bought/Sold list derived from differences between nightly snapshots (starts after the second snapshot; trades between snapshots appear as one net change).
- New data file `balances.json` in the data directory.

## v0.1.21: Loan tab layout, scenarios side by side, reserve figure

- The Loan tab is split into **Inputs, Result, Payoff, Scenarios** so you scroll less. "Save and calculate" jumps to Result.
- **Scenarios** shows Normal and Job loss, with and without the selected loan, side by side (lowest cash, month, when cash runs out, months under reserve). Click a column heading to show or hide its line on the chart.
- **Reserve needed** for the job loss is the cash that must already be set aside when it starts so cash never hits zero (no new loan), also in months of spending, with a button to adopt it as your reserve.
- A **summary bar at the bottom** (selected loan, borrow amount, payment, verdict) stays visible on the Loan tab; tap it to go to Result.
- Fixes: the "How Net worth, Invest, Assets and Actual fit together" text showed as "[object ...]"; Assets values now count toward Net worth even before any SimpleFIN balances exist.

## v0.1.22: sortable and filterable tables

Outside the Loan tab, click a column heading to sort ascending, then descending, then back to original order. A dropdown under each heading filters to one value (shown when a column has 2 to 30 distinct values). On phones, a "Sort and filter" control above each table does the same. Money and percent text sorts numerically.

## v0.1.23: Utilities tab (electric, water, gas)

- **Import** on the Utilities tab: Duke Energy Green Button XML (15-minute readings, stored as daily kWh), Duke and gas usage CSVs (columns matched by header words), and City of Raleigh water PDF bills. Re-importing a period replaces it, and fields a later import lacks are kept, so a usage CSV and a bill PDF for the same period merge.
- Only figures are stored. Names, addresses and account numbers in the files are ignored.
- Per utility: last-12-bills KPIs, usage and cost charts, daily electric usage, a sortable bills table, and a flag when usage or cost is 30% or more above the same period a year earlier.
- **Paid in Actual**: monthly totals of payments whose payee matches a pattern (Settings, "Payee patterns"; defaults: `duke energy`, `raleigh`, `enbridge|piedmont`).
- PDF reading needs `pdftotext`; `install-lxc.sh` now installs `poppler-utils`. On an existing container run `apt-get install -y poppler-utils`.
- Uploads up to 80 MB (the Duke XML is about 23 MB). Duke PDF bills and Enbridge files are not parsed yet: send a redacted sample.

## v0.1.24

- **Utilities: see the payment behind a chart point.** Click a point on the usage, cost or "Paid per month" chart, or a period end in the bills table. A panel shows the matching payment(s) from Actual (date, payee, account, amount, notes) with a link to the account in Actual. Actual cannot link to a single transaction, so the details are shown here. Bills match payments dated from 5 days before the period end to 50 days after, closest in amount first.
- **Fix (issue #3):** the "Time to update ..." banner now clears when a value is pulled from changedetection.io (not only when typed by hand), and it refreshes right after any change on the Assets tab. Automatic estimates still do not count as checking the value.

## v0.1.25: find utility payments by category

- Utilities settings ("How payments are found") now has a mode: **payee name only** (default, as before), **Actual category only**, **either**, or **both**. Pick the Actual categories for each utility and/or the payee pattern. "Both" is the strictest and needs a payee pattern and a category for each utility.
- Saving these settings now applies immediately and reloads the tab; no recalculation step is needed.

## v0.1.26: category dropdown; Amazon department report

- Utilities settings: the Actual categories for each utility are now a dropdown that shows what is selected, scrolls, and can be filtered by typing.
- Amazon tab: a table lists each proposed Actual category with the Amazon department it came from, the rule that chose it (item keyword, department mapping or the category Actual already had), charges and spend, so a bad rule is easy to spot. Click a heading to sort.
- If the order file has a department / category column (matched by name: department, product category, item category, category, product group), a second table lets you map each Amazon department to an Actual category (saved in Settings as `amazon.departmentCategories`). It is used only when no item keyword matched. If the file has no such column, the tab says so and lists the columns it found. The standard "Request My Data" export may not include one.

## v0.1.27: all years overlaid, weather, and rate impact (Utilities)

- **All years on top of one another**: pick usage per day, usage, cost, rate, temperature, degree days or rain; one line per year across Jan to Dec, newest year in blue. Hover shows every year at that month.
- **Weather**: daily temperature and rain for your location come from Open-Meteo's free historical archive (no account), fetched on import, on "Refresh weather" and in the nightly job, and only for days not already stored (the archive lags about 6 days). Set latitude and longitude in the Utilities settings (default: Raleigh city centre). Each bill gets average temperature, heating degree days, cooling degree days and rain; Duke's CSV temperature is used when weather is unavailable. Weather is stored in `weather.json`. The weather download could not be tried against the live service while building this; if it fails, the tab shows the error.
- **Year over year**: each year is compared with the one before using only the months both have. The cost change is split into "used more or less" (at last year's rate) and "rate changed" (on this year's usage), plus the weather difference (warmer or cooler, cooling and heating need, wetter or drier).
- Tables hide filter dropdowns on number columns and on tables under 6 rows.

## v0.1.28: weather download diagnostics

- When the weather service (or something between this server and it) answers with something that is not data, the error now shows the HTTP status and the first part of what came back, instead of a JSON parse error. Long ranges are fetched in year-sized requests.
