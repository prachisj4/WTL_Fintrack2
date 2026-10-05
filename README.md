# Fintrack Family — Financial Literacy & Budgeting App

A full-stack educational **MVP** built with HTML, CSS, browser JavaScript, Node.js, Express, and SQLite. It works on Ubuntu and stores data locally in `fintrack.db`.

## What it does

- Register / sign in (passwords are salted and hashed; HttpOnly session cookies).
- Record income, expenses, and **tracked savings allocations** in Indian rupees.
- Dashboard with income, spending, allocated savings, available balance, and a monthly expense-category visualization.
- Personal savings goals with tracked contributions and progress.
- Create family circles, invite family members with a code, record shared transactions, set shared monthly budgets, and contribute to family savings goals.
- Eight accessible educational mini-lessons on money and economics.
- Responsive desktop and mobile layouts; no frontend build tools needed.

## Run on Ubuntu

1. Install Node.js **20 or newer** and npm (Node.js 22 LTS recommended). Check:

   ```bash
   node --version
   npm --version
   ```

2. Extract this ZIP and open a terminal in the extracted `fintrack-app` directory:

   ```bash
   cd fintrack-app
   npm install
   npm start
   ```

3. Open **http://localhost:3000** in your browser. Create an account. A `fintrack.db` file will be created automatically on first run.

For hot restart during development, use `npm run dev` instead of `npm start`.

## Folder structure

```text
fintrack-app/
├── public/
│   ├── index.html       # All pages, forms, and app shell
│   ├── styles.css       # Responsive design
│   └── app.js           # Frontend app, API calls, lessons, UI rendering
├── server.js            # Express API and authentication
├── schema.sql           # SQLite tables and indexes
├── package.json         # Dependencies and commands
├── .gitignore
└── README.md
```

## Try the family feature

Register two different accounts (use separate browser profiles or log out and back in). In the first account, go to **Family circle**, create a family, and copy the invitation code. Use the second account to **join**. Either user can add family transactions and contributions. The creator can change the family monthly budget.

## Database (SQLite)

`schema.sql` runs automatically on launch; no MySQL/Postgres service or manually imported seed is needed. To examine the data on Ubuntu:

```bash
sudo apt install sqlite3
sqlite3 fintrack.db '.tables'
sqlite3 fintrack.db 'SELECT type, category, amount / 100.0 AS rupees FROM transactions;'
```

All monetary values in the DB are **integer paise** to avoid floating-point currency errors. `sessions` contains hashed random session tokens. Avoid committing/sharing the generated database.

## Key API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/register` | New account |
| POST | `/api/login` | Sign in |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user |
| GET/POST | `/api/transactions` | List and create personal or family records |
| DELETE | `/api/transactions/:id` | Delete your own entry |
| GET/POST | `/api/goals` | List/create personal or family goals |
| DELETE | `/api/goals/:id` | Delete personal goal or owner-managed family goal |
| GET/POST | `/api/families` | List/create families |
| POST | `/api/families/join` | Join with invite code |
| GET | `/api/families/:id/members` | List family members |
| PATCH | `/api/families/:id/budget` | Owner updates monthly budget |
| GET | `/api/dashboard` | Personal or family totals and expense category data |

Pass `?family_id=1` to family-aware goal/dashboard endpoints; transactions uses `?scope=family&family_id=1`. Family membership checks apply on the server.

## Important limitations

- This is a locally runnable **prototype**, not a regulated financial product. "Saving" only records allocations in the app; it does **not** move real money, create bank accounts, connect UPI, or buy investments.
- Personal and family ledgers are **separate**. Family transactions do not automatically appear in personal transaction totals; if you want one combined ledger, redesign this behavior before launch.
- A family invitation code grants membership to anyone who has it. Share it only with intended members. There is no account recovery, email confirmation, multi-factor authentication, role management, per-user family privacy, or audit trail yet.
- Family financial entries are visible to all family members; members can delete **only their own** transaction entries.
- All-time summary totals are based on recorded activity and are **not a verified bank balance**. Monthly category summaries follow the server's month (UTC); the family current-month filter in the UI follows the browser's local month. For production, use a consistent configurable timezone.
- The UI uses a Google Fonts stylesheet when connected to the internet; it falls back to standard local fonts when offline.
- For public deployment: use HTTPS with `COOKIE_SECURE=true`, a reverse proxy, server-side request throttling, CSRF defenses appropriate to your deployment, email verification, secure backups, privacy policy and professional security review. Avoid running SQLite on a shared network filesystem.
- Lessons are introductory and include external links to RBI, SEBI, IMF, and CFPB educational resources. They are not individualized investing advice.

## Next possible features

CSV exports, recurring transactions, debt management, native Android/PWA install, learning quizzes, notifications, multilingual lessons (Hindi/Marathi), spending alerts, and optional bank integrations only after reviewing regulatory/security requirements.
