# Family Fitness (v1)

A simple website where your family logs workouts, times sets, and follows each other's progress. Everyone joins with a family code, so there are no passwords, and it can be added to a phone's home screen so it opens like an app.

You own everything: the code lives in your GitHub account, and the data lives in your Supabase account. Both are free for a family-sized group.

Setup takes about 30 minutes, done once.

---

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The page itself |
| `app.js` | Everything the app does (screens, timer, charts) |
| `styles.css` | Colors, fonts and layout. Colors are at the top if you want to change them |
| `config.js` | **The only file you need to edit.** Your two Supabase values go here |
| `supabase-setup.sql` | Creates the database. You paste this into Supabase once |
| `manifest.json` + icons | Make it look like an app on the home screen |

---

## Step 1: Create the database (Supabase)

1. Go to **supabase.com** and sign up (signing in with GitHub is easiest, see step 4).
2. Click **New project**.
   - Name: `family-fitness`
   - Database password: click *Generate*, and save it somewhere safe (you won't need it for the app).
   - Region: pick the one closest to your family.
3. Click **Create new project** and wait a minute or two while it sets up.

## Step 2: Set up the tables

1. In the left sidebar, open **SQL Editor**.
2. Click **New query**.
3. Open `supabase-setup.sql` from this folder, copy **all** of it, and paste it in.
4. Click **Run**. You should see "Success. No rows returned."

If Supabase shows a warning asking you to confirm, confirm it. The script doesn't delete anything, and it's safe to run again.

## Step 3: Connect the website to the database

1. In Supabase, click **Connect** at the top of the project, or go to **Project Settings → API Keys** (and **Data API** for the URL).
2. Copy two things:
   - **Project URL**: looks like `https://abcdefgh.supabase.co`
   - **Publishable key**: starts with `sb_publishable_…`. On older projects this is called the **anon public** key; that one works too.
3. Open `config.js` in any text editor (Notepad is fine) and replace the two placeholder values:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_KEY: "sb_publishable_xxxxxxxxxxxx",
};
```

⚠️ Never use the **secret** or **service_role** key. The publishable key is designed to be public; the secret one is not.

## Step 4: Put the website online (GitHub Pages)

1. Go to **github.com** and create a free account.
2. Click **+** (top right) → **New repository**.
   - Name: `family-fitness`
   - Set it to **Public** (GitHub Pages is free for public repositories).
   - Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in **all the files from this folder** (not the folder itself), then click **Commit changes**.
5. Go to the repository's **Settings → Pages**.
   - Under *Build and deployment*, Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)**, then **Save**.
6. Wait 1 to 2 minutes and refresh. A link appears at the top, like:
   `https://yourname.github.io/family-fitness/`

That's your website.

*Is public code safe?* Yes. People could read the code, but not your family's data: that's protected by your family code, which isn't in the code.

## Step 5: Start your family

1. Open your link, enter a family name, and tap **Create family**.
2. Add yourself.
3. Go to **Settings** (tap your initial, top right) → **Share invite**, and send it to the family chat.

Family members just tap the link, then tap **Add me** (or their name if you added them).

## Step 6: Add it to each phone's home screen

- **Android (Chrome):** open the link → tap **⋮** → **Add to home screen** (or **Install app**).
- **iPhone (Safari):** open the link → tap the **Share** button → **Add to Home Screen**.

It gets its own icon and opens full screen, like an app. For less tech-comfortable relatives, you can do this step for them once, or print a QR code of the link (search "QR code generator") and stick it on the fridge.

---

## Good to know

- **The family code is the key.** Anyone with it can see and add to your family's data, so only share it with family.
- **Free Supabase projects pause after about a week of no use.** If nobody logs anything for a week and the app says it can't reach the server, open supabase.com and click **Restore** on the project. Your data is kept.
- **Timer sound:** the countdown beeps when it ends, as long as the app is open on screen. Phones silence web pages in the background, so keep the screen on. The app tries to stop the screen from sleeping while a timer runs.
- **Backups:** in Supabase, open **Table Editor**, pick a table, and use **Export → CSV**.
- **Supabase "Security Advisor" notes** about tables having no policies are expected: the tables are deliberately locked, and the app only goes through the functions in the setup script.

## Making changes later

Edit a file on GitHub (open it, click the ✏️ pencil, **Commit changes**) and the site updates within a minute or two. On phones, close and reopen the app to see the change.

- Colors: top of `styles.css`
- Suggested exercises and member colors: top of `app.js` (`SUGGESTIONS`, `COLORS`)

## Ideas for v2

Editing past entries, reactions and comments on each other's entries, family challenges, streak badges, a PIN per person, and working offline.
