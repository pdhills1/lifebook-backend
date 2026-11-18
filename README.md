# My Story - a life-story book for your family

Parents answer friendly questions at their own pace, add photos with captions, and the site turns it all into a
properly designed PDF book, emailed to them (and to you) when they finish. It runs as **one website** - no
separate frontend - on free Supabase and Render accounts.

## Setting it up (about 15 minutes, once)

**1. Database (Supabase)**
- Create a free project at supabase.com. (Reusing your existing one? Fine - this upgrades it and closes a security gap in the first version.)
- Open **SQL Editor -> New query**, paste the whole of `setup.sql`, press **Run**. Safe to run more than once.
- Open **Project Settings -> API Keys** and keep three things handy: the project URL, the **publishable** key and the **secret** key.
  If you pasted a key anywhere public, use "rotate" next to it first.

**2. Put the code on GitHub**
- Create a private repository and upload everything in this folder (`.env` must not be uploaded; it is ignored automatically).

**3. Website (Render)**
- render.com -> **New -> Blueprint**, pick the repository. It reads `render.yaml`.
- Fill in the prompted values: the Supabase URL and keys, and `ADMIN_EMAILS` (your email address).
  Optional: `INVITE_CODE` (a word people must type to register) and `RESEND_API_KEY`.

**4. First visit**
- Open the address Render gives you. **Create your own account first** - an email in `ADMIN_EMAILS` becomes the administrator and gets an *Admin* button.
- The Admin page has an "Is everything set up?" panel that tells you in plain English if anything is missing.
- Send the address (and the invite code, if you set one) to the people you're inviting.

**5. Emails (optional but recommended)**
- Without email: everything works; books are downloaded from the site and you reset passwords from the Admin page.
- With email: create a free account at resend.com, add the key as `RESEND_API_KEY`. Until you verify a domain there, Resend can only send to your own address - verify one and set `EMAIL_FROM` to send to your family.
- For password-reset links, set Supabase **Authentication -> URL Configuration -> Site URL** to your Render address.

Note: Render's free plan sleeps after 15 minutes idle, so the first page load after a quiet spell can take ~30 seconds. Work is saved automatically as people type, and nothing is lost.

## What people see
12 chapters (children and grandchildren each get their own page in chapter 8). A few key questions per chapter must be answered; everything else is optional, and a chapter that doesn't apply can be left out. Progress is saved as they type, so they can stop and return any time, from any computer. Text size can be enlarged from the top bar. Anyone can see a draft of the book whenever they like.

## Running it on your own computer
```
npm install
cp .env.example .env     # fill it in
npm start                # http://localhost:3000
npm test                 # 12 automated checks (no Supabase needed)
node test/dev-server.js  # try the whole site against a built-in fake database
```
Requires Node 22+.

## Changing the questions
Edit `server/content/book-schema.json` (prompts, which are `core`, chapter titles). The site and the PDF both read it.

## Safety notes
- The browser never talks to the database; only the server does, with the secret key. Row-level security is on with no public access.
- Photos are private and shown through short-lived links.
