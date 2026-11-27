# Script board — Netlify + Neon

## Deploy
Drag-and-drop (Netlify Drop) does NOT run the database function. Use one of:
- **GitHub:** push this folder to a repo → Netlify → Add new site → Import from Git.
- **CLI:** `npm i -g netlify-cli` → in this folder: `netlify deploy --build --prod`

## Connect Neon
Pick one:
- **New database:** Netlify site → Extensions → Neon → Add. It sets `NETLIFY_DATABASE_URL` for you.
- **Existing Neon project:** Netlify site → Site configuration → Environment variables → add `DATABASE_URL` = your Neon connection string (Neon console → Connect → copy the `postgresql://…` string).

Redeploy after adding the variable. Tables (`sb_scripts`, `sb_meta`) are created automatically, and the first visit loads all the scripts.

## Google sign-in (recommended)
Only people you allow can open the board, and every change records who made it.
1. console.cloud.google.com → create a project (e.g. "Script board").
2. APIs & Services → OAuth consent screen → User type **Internal** (if atomcontent.in is on Google Workspace) or **External** → fill app name + support email → Save.
3. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Web application.
   - Authorized JavaScript origins: `https://scriptboard0.netlify.app`
   - No redirect URI needed. Create → copy the **Client ID** (ends in `.apps.googleusercontent.com`).
4. Netlify → Environment variables:
   - `GOOGLE_CLIENT_ID` = that Client ID
   - `ALLOWED_DOMAIN` = `atomcontent.in` (comma-separate for more)
   - `ALLOWED_EMAILS` = optional extra people outside the domain, e.g. `someone@gmail.com,other@gmail.com`
   - `SESSION_SECRET` = any long random text
5. Redeploy. Anyone who signs in is added to Team with their email automatically, so they get tag emails.
When sign-in is on, `EDIT_KEY` is ignored.

## Optional: edit passcode (only if sign-in is off)
Add env var `EDIT_KEY` = any passcode. Anyone with the link can still view; saving asks for the passcode once per browser. Without it, anyone with the link can edit.

## Email notifications (from your Google account)
When someone is tagged (POC or a task) and saved, they get an email, sent from your own Gmail/Workspace account.
1. script.google.com → New project → paste `google-email-sender.gs` → Save. Run `testEmail` once to allow access.
2. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone** → copy the /exec URL.
3. Netlify → `MAIL_WEBHOOK` = that URL → Redeploy.
Only addresses at the domains in `ALLOWED_DOMAINS` (plus `EXTRA_EMAILS`) can receive emails.

## Google sign-in (recommended)
Only people you allow can open the board, and every change records who made it.
1. console.cloud.google.com → create a project (e.g. "Script board").
2. APIs & Services → OAuth consent screen → User type **Internal** (if atomcontent.in is on Google Workspace) or **External** → fill app name + support email → Save.
3. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Web application.
   - Authorized JavaScript origins: `https://scriptboard0.netlify.app`
   - No redirect URI needed. Create → copy the **Client ID** (ends in `.apps.googleusercontent.com`).
4. Netlify → Environment variables:
   - `GOOGLE_CLIENT_ID` = that Client ID
   - `ALLOWED_DOMAIN` = `atomcontent.in` (comma-separate for more)
   - `ALLOWED_EMAILS` = optional extra people outside the domain, e.g. `someone@gmail.com,other@gmail.com`
   - `SESSION_SECRET` = any long random text
5. Redeploy. Anyone who signs in is added to Team with their email automatically, so they get tag emails.
When sign-in is on, `EDIT_KEY` is ignored.

## Optional: edit passcode (only if sign-in is off)
Add env var `EDIT_KEY` = any passcode. Anyone with the link can still view; saving asks for the passcode once per browser. Without it, anyone with the link can edit.

## Email notifications
When you tag someone (POC or a task) and save, they get an email. Uses Brevo (no DNS needed). Setup:
1. Sign up at brevo.com (free: 300 emails/day).
2. Senders: Settings → Senders, domains & dedicated IPs → Senders → Add a sender → enter your email → confirm the code Brevo emails you.
3. API key: Settings → SMTP & API → API keys → Generate a new API key.
4. Netlify → Environment variables:
   - `BREVO_API_KEY` = the key (starts with `xkeysib-`)
   - `MAIL_FROM` = `Script board <the-email-you-verified>`
5. Redeploy. Add each person's email under Team.
If emails land in spam, ask teammates to mark them "Not spam" once.

## Google Doc → Drafting
Every new top-level tab added to the "Content Apoorv" Doc appears in Drafting (title = tab name, script = tab text). Tabs under "Shot & edited" are ignored.
1. In the Doc: Extensions → Apps Script → paste `google-doc-sync.gs` → Save.
2. Choose `setup` → Run → allow access.
Tabs that already exist are skipped. New tabs sync within ~10 minutes, once their text stops changing.

## Notes
- Changes show for everyone within ~5 seconds.
- Calendar reminders only work inside claude.ai. "Copy reminder" works everywhere.
- The website lives in `public/`. Keep `Content Apoorv-c631437e.pdf` next to `public/index.html` so the Doc links open.
- Never commit secrets (`.env`, connection strings, API keys). Put them only in Netlify → Environment variables.
