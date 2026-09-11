# SentinelGate — OTP Backend

A small Express server that generates a one-time code, emails it for real using
your Gmail account, and verifies it — solving the "OTP visible on screen" gap
in the front-end-only demo.

## 1. Get a Gmail App Password (one-time setup, ~2 minutes)

Gmail won't let apps log in with your normal password. You need an "App Password":

1. Go to your Google Account → **Security**
2. Turn on **2-Step Verification** if it isn't already on (App Passwords require it)
3. In the search bar at the top of Google Account settings, type **App Passwords**
4. Create a new one — name it something like "SentinelGate"
5. Google shows you a 16-character password (e.g. `abcd efgh ijkl mnop`) — copy it,
   remove the spaces, and save it somewhere safe. You won't be able to see it again.

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in:
```
GMAIL_USER=youraddress@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop   (no spaces)
PORT=4000
```

## 3. Install and run

```bash
npm install
npm start
```

You should see:
```
✅  Email transport ready — real OTP emails can be sent.
SentinelGate OTP backend listening on http://localhost:4000
```

If you instead see a warning about "Email transport not ready," double-check your
`.env` values — the most common issue is pasting the app password with spaces still in it.

## 4. Connect the front-end

Nothing else to do — `script.js` in the project root already tries
`http://localhost:4000` automatically:

- **Backend running** → the OTP is generated server-side and really emailed to the
  user's address; the browser never sees the code.
- **Backend not running** → the app quietly falls back to the old on-screen "demo mode"
  OTP, so grading/demoing still works even without the backend started.

## 5. Test it directly (optional, without the front-end)

```bash
curl -X POST http://localhost:4000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"your.test.address@gmail.com","username":"test"}'

# check your inbox for the code, then:
curl -X POST http://localhost:4000/api/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"your.test.address@gmail.com","code":"123456"}'
```

## 6. Optional — mirror users & resources to Supabase

`db.json` stays the primary database no matter what — this step just also pushes a copy of
your users and resources/policies to a real Supabase (Postgres) project in the cloud.

1. Create a project at https://supabase.com, then go to **Project Settings → API** and copy your
   **Project URL** and **`service_role` secret key** (not the `anon` key — the service role key
   is for trusted backend code only, never put it in front-end JavaScript).
2. In Supabase's **SQL Editor**, run:
   ```sql
   create table users (
     id bigint primary key,
     username text unique not null,
     password text not null,
     role text not null,
     name text,
     email text,
     status text,
     created_via text
   );

   create table resources (
     id bigint primary key,
     name text not null,
     sensitivity text,
     roles jsonb,
     require_trusted_device boolean,
     require_mfa boolean
   );
   ```
3. Add to your `.env`:
   ```
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key-here
   ```
4. Run `npm install` again (installs the new `@supabase/supabase-js` package)
5. Restart the server — you should see `✅ Supabase configured — users & resources will sync there too.`

From then on, every time the app saves (login, registration, admin editing a role or resource),
the same data is written to `db.json` **and** upserted into your Supabase `users`/`resources`
tables. If Supabase is unreachable for any reason, `db.json` still saves normally — Supabase
failures are logged as warnings but never block the app.

## How it works (for your report)

| Endpoint            | What it does |
|----------------------|---------------|
| `POST /api/send-otp`   | Generates a random 6-digit code, stores it server-side keyed by email with a 30-second expiry, sends it via Nodemailer/Gmail SMTP |
| `POST /api/verify-otp` | Looks up the code for that email, checks it hasn't expired and hasn't exceeded 5 attempts, compares it, then deletes it (one-time use) |
| `GET /api/state`       | Returns the full application database: users, resources & policies, activity logs, alerts, access requests, and academic profiles |
| `POST /api/state`      | Overwrites the database with whatever the browser sends — this is how every action in the app gets saved permanently |

## The database

Real, persistent data now lives in **`backend/data/db.json`** — a plain JSON file created
automatically the first time the server starts. It survives server restarts and browser reloads.

- On page load, the browser fetches this file's contents (`GET /api/state`) so it starts from
  whatever was last saved — new users, added resources, past logs, everything.
- After almost any action (logging in, registering, an admin changing a role, a resource being
  added, an access request being made, a student viewing their academic profile for the first
  time), the browser sends its entire current state back (`POST /api/state`), which overwrites
  `db.json`.
- If you want to reset everything back to the original demo data, just delete `data/db.json` and
  restart the server — it will recreate it from the built-in seed data.

**Why a JSON file instead of a "real" database like MySQL/SQLite?** No extra installs, no native
compilation, no separate database server to run — which matters a lot given the setup issues
around PowerShell and native npm modules. It's a genuinely persistent database (data really does
survive restarts), just not one built for many people writing to it at the exact same time —
fine for a single-admin college project demo, not something you'd scale to a real multi-thousand
-user college system without upgrading to a proper database engine. Worth mentioning as a known
limitation if asked in a viva.

The code is generated and checked entirely on the server — the browser only ever
sends the code the user *typed*, never the code itself. This is the same basic
pattern real MFA providers (Auth0, Okta, Firebase Auth) use, just without their
scale, redundancy, and abuse-prevention infrastructure.

## Limitations (be upfront about these if asked)

- OTPs are stored in memory (a JS `Map`) — if the server restarts, all pending
  codes are lost. Production systems use Redis or a database with TTL.
- No rate limiting on how often `/api/send-otp` can be called per email — a real
  system would throttle this to prevent spam/abuse.
- Uses your personal Gmail account for sending — fine for a demo/project, but a
  production system would use a dedicated transactional email service
  (SendGrid, Resend, Amazon SES) so it isn't tied to one person's inbox.
