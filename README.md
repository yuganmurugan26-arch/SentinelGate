# SentinelGate — Zero Trust Access Management System

A working demonstration of Zero Trust access control ("never trust, always verify") for a college
environment with three roles: **Admin**, **Faculty**, and **Student**.

## How to run
Open `index.html` in any modern browser. No build step, no server, no dependencies to install —
it's a static front-end app (HTML, CSS, vanilla JavaScript). Requires internet access only to load
Google Fonts; everything else runs locally in the browser.

## Project structure
```
SentinelGate/
├── index.html         → page structure & all view templates
├── style.css          → design system (colors, layout, components)
├── script.js          → application logic (auth, RBAC, policy engine, logging)
├── backend/           → optional Node.js server that sends REAL OTP emails
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── README.md      → setup steps (Gmail App Password, npm install, run)
└── README.md          → this file
```

### Front-end only, or front-end + backend?
The app works standalone by just opening `index.html` — MFA falls back to an
on-screen "demo mode" code. If you also start the backend (see `backend/README.md`),
the app automatically detects it and sends a real OTP by email instead, so the
code is never visible in the browser. See `backend/README.md` for the 5-minute setup.

## Demo accounts
| Username | Password    | Role    |
|----------|-------------|---------|
| admin    | Admin@123   | Admin   |
| faculty  | Faculty@123 | Faculty |
| student  | Student@123 | Student |

New Student/Faculty accounts can also be self-registered from the sign-in screen.

## How the Zero Trust flow works
```
User → Authentication → Identity Verification → Access Policy Check → Authorization → Resource
```
This exact pipeline is visualized on screen and re-run for **every** login and **every**
resource access request — a valid session never implies automatic trust for a new action.

1. **Authentication** — username + password checked against the user store.
2. **MFA (OTP)** — a 6-digit one-time code is required after password validation
   (shown on-screen in this demo, since there is no real SMS/email backend).
3. **Identity Verification** — the authenticated identity and role are confirmed.
4. **Access Policy Check** — the target resource's policy is evaluated: is this role allowed,
   is a trusted device required, is MFA required.
5. **Authorization** — grant or deny decision is produced from the policy check.
6. **Resource** — access is only reached if every prior step passed.

## Modules implemented
| Module                              | Where in the app |
|--------------------------------------|-------------------|
| User Registration & Login            | Sign-in screen (`Create an account`) |
| MFA / OTP Verification               | Sign-in flow, step 2 |
| Role-Based Access Control (RBAC)     | `Users & Roles` (Admin) |
| Least Privilege Access               | Default role scoping; new users get minimal access |
| Device Verification                  | "Trusted device" toggle at login; enforced per-resource |
| Access Policy Management             | `Resources & Policies` (Admin) |
| Session Management                   | 5-minute inactivity auto-logout, live countdown |
| OTP Expiry                           | 30-second countdown on the MFA screen; code is rejected (client- and server-side) once it expires, with a "resend code" option |
| Continuous Verification              | Periodic trust-score re-evaluation while logged in |
| Access Request & Approval            | `Request Access` (user) → escalation queue (Admin) |
| Activity / Audit Logging             | `Activity Logs`, CSV export under `Audit Reports` |
| Security Alerts                      | Auto-generated on repeated failed logins, denied
                                          access to sensitive resources, untrusted-device logins |
| Admin Dashboard                      | Stats, recent activity, role distribution, alerts |

## Example scenario (matches the brief)
Log in as **student** → go to **Request Access** → choose **Finance & Admin Console**.
Even with a fully authenticated, MFA-verified session, the request is denied — the policy
engine checks the Student role against the resource's allowed-roles list on every single
request, not just at login.

## Design notes
- Palette and type system are custom-built for this project (Space Grotesk / Inter / JetBrains Mono)
  rather than a generic template, to read as a real security-product UI.
- The connected-node "pipeline" visual is the signature element — it's not decorative, it
  literally renders the same six-stage verification sequence described in the assignment brief,
  and re-plays it live for every access decision.

## Limitations (by design, for a demo)
- Data is stored in memory only and resets on page reload — there is no user database.
- OTP codes are shown on-screen **only when the backend isn't running** (offline fallback);
  with the backend started (see `backend/`), real codes are emailed and never appear in the browser.
- Passwords are stored in plain text in the in-browser data model for demo simplicity; a
  production system would hash and salt credentials server-side, and login itself
  (not just OTP) would go through a backend rather than living in client-side JS.
