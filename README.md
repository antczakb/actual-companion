# Actual companion

A small web app that sits beside your Actual Budget server and reads it through Actual's official API. It does not modify Actual's code, so Actual upgrades do not break it. Everything runs on your own server; nothing is sent anywhere except to Actual, SimpleFIN and SnapTrade.

| Tab | What it does |
|---|---|
| **Loan** | Projects cash from your Actual balances and spending, adds planned purchases, and sizes the smallest loan that keeps cash above your reserve floor (HELOC, home equity loan, personal loan). Same rule as the workbook's Loan_Planner. |
| **Budget** | Suggests a monthly amount per category from your last 12 months, compares it with the current month's budget, and gives the matching Actual `#template` line. Report only; it never changes your budget. |
| **Investments** | Pulls balances and holdings from SnapTrade into snapshots kept by this app (not in Actual's ledger) and charts the total over time. |
| **SimpleFIN** | Shows every field SimpleFIN sends, as tables (accounts and transactions), so you can see what detail exists. |
| **Venmo** | Upload a Venmo statement CSV; matches each payment to the bank's "VENMO PAYMENT" row and proposes the real payee, note and category. Nothing is written until you press Apply. |
| **Settings** | Loan products, home value, mortgage, planned purchases, reserve, tolerances (JSON). |

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
2. **Loan tab, "based on N months"** should match how much history you imported (25 months for you). Cash today should equal your on-budget account balances. If it is off, set `projection.cashAccounts` in Settings to the accounts you count as cash.
3. **Settings:** enter `loan.homeValue`, `loan.mortgage`, your real loan quotes under `loan.products`, and planned purchases, for example `{"month":"2027-06","amount":60000,"name":"Kitchen"}`. Until then the page warns you.
4. **Compare one number with the workbook:** use the same inputs and the Loan_Planner's suggested loan should agree. If it does not, tell me both sets of inputs.
5. **SimpleFIN tab:** look at the columns for your Venmo-related transactions. Anything beyond `description` is new information.
6. **Budget tab:** check that "uncategorized" is small. Uncategorized spending is left out of the suggestions, and counted as spending in the loan projection.

## Venmo, month by month

1. venmo.com, Statements, pick the month, Download CSV.
2. Venmo tab, choose the file, Preview matches.
3. Review: each row shows what the bank says, the payee and note that would be set, and a category (from your past payments to that person, or from keywords in the note, or the category it already has). Change any category in the dropdown, untick rows you do not want.
4. Apply selected to Actual.

Notes: matches need the same amount and a date within `venmo.dayWindow` days (default 5, for ACH delay). Each updated bank row gets a marker like `[venmo:12345]` in its notes so a second run never touches it twice. Payments made from your Venmo balance have no bank row; they are listed separately. Add `venmo.keywordCategories` in Settings, for example `{"rent":"Housing: Rent"}`. Use the category's exact name as it appears in Actual. If your Actual setup already has a rule that renames "VENMO" payees, applying a row replaces that payee with the person's name.

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
- The projection holds income and spending flat (optional yearly growth in Settings) and treats planned purchases as one-time.
