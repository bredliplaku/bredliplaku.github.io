# Teaching pages — setup & sharing guide

**Showing a lecturer's courses on their existing website?** In Settings, save
their Lecturer account and courses, then download their website file from the
public admin page. Upload that `index.html` to the desired website folder once.
It shares this application and database; no website address, fork, DNS change,
or separate Supabase setup is required. Lecturers can download their own file.
Their Sign In button opens `?admin` on the same website. Before using it, approve
that exact return address in Supabase as described below.
The independent deployment instructions below are for people who want to operate
their own unrelated teaching system.

**Upgrading an existing installation for Admin/Lecturer/Student permissions?**
Follow the [teaching roles upgrade](supabase/ROLES.md). Run `supabase/roles.sql`
in your existing project before publishing the updated editor; your current
course data and Google sign-in stay in place.

This folder is a self-contained "course website + admin panel". Your site settings
(Supabase keys, Google sign-in, name, links, colours) live in
**`teaching/js/config.js`**. Database setup also requires your administrator email
in the SQL files, and the timetable proxy requires your site's origins, as described
below. Keep those deployment settings when pulling the original author's updates.

There are two audiences below:

- **[Running your own copy](#running-your-own-copy)** — a colleague setting up their instance.
- **[Before you share it](#before-you-share-it)** — the original author preparing the repo for others.

## Admin on a lecturer's website

Publish the updated central teaching files, including `embed.js`, the public and
admin scripts, and `admin/index.html`. Existing personalized downloads pick up
this change automatically; nobody needs to upload another file.

For a file uploaded to `https://eriseldagoga.com/academic/`, the admin address is:

```text
https://eriseldagoga.com/academic/?admin
```

In **Supabase → Authentication → URL Configuration → Redirect URLs**, add that
exact address. Add the `www` version separately only if it is also used. Use each
lecturer's actual domain and upload folder; avoid broad wildcard entries. Keep
the project's existing Site URL. Configure this before sign-in: an unapproved
return address can fall back to the project's Site URL instead.

The Sign In button uses Supabase's existing Google provider. Google authenticates
the person, Supabase returns them to the approved `?admin` address, and the database
checks their teaching role and course assignments. The lecturer ID in the uploaded
file supplies branding, never account permissions. Refresh, logout, and Back keep
the lecturer's own website address. `/academic/admin/` is not created by the file.

Embedded admin uses PKCE and a separate browser session key for each lecturer
website. It requires HTTPS (localhost is allowed for local development). Google
One Tap remains available on the original admin page; embedded admin uses the
Supabase Sign In button. The optional Google Drive picker still uses Google's
JavaScript OAuth client and needs the site's origin registered in Google Cloud
if that feature is used. Pasting file links does not need the picker.

The redirect allowlist controls where OAuth returns; it cannot stop someone
copying or hosting the public files. It also does not bind existing sessions or
API requests to a website. Approve only websites you trust with signed-in sessions.
Use Settings to remove account/course access; removing a redirect URL alone does
not revoke a previously issued session. Public course pages remain readable
without sign-in or website registration.

References: [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Google sign-in through Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

---

## Running your own copy

You'll need: a GitHub account, a (free) Supabase account, and a Google account.
Budget ~20–30 minutes the first time.

### 1. Get the code

1. **Fork** the original repository on GitHub (top-right → *Fork*).
2. In your fork: **Settings → Pages →** set the source to the `main` branch. Your site
   will publish at `https://<your-username>.github.io/` (user site) or
   `https://<your-username>.github.io/<repo>/` (project site). Note this URL — you'll
   need it in steps 4 and 5.

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a name and a
   database password; wait for it to provision.
2. **Project Settings → API** and copy two values for later:
   - **Project URL** → goes into `supabaseUrl`
   - **anon / public key** → goes into `supabaseAnonKey`

   (Both are safe to commit — they're meant to be public. Your data is protected by
   Row-Level Security, set up by the schema in the next step, not by hiding the key.)

### 3. Create the database schema

In the Supabase dashboard: **SQL Editor → New query**, paste the contents of
[`supabase/schema.sql`](supabase/schema.sql), and **Run**. This creates the
`course_rows` and `admins` tables plus the Row-Level Security policies (public read,
admin-only write).

> Before running `schema.sql`, set the **bootstrap email** at the
> bottom to your own Google account — that's the row that lets you into the admin panel.
> The file's header notes a couple of things to double-check (e.g. whether admins are
> keyed by email vs. user id).

Next open [`supabase/roles.sql`](supabase/roles.sql) and set
`teaching.admin_email` at the top to the same administrator email you chose
in `schema.sql`. Run the file in full to install teaching roles, course assignments,
and the checked save functions used by the editor.
See the [roles guide](supabase/ROLES.md) for the permission matrix and Settings.

### 4. Deploy the timetable proxy (Edge Function)

The public timetable is fetched through a small serverless function so the browser
never talks to the university site directly.

The `supabase/` folder lives inside `teaching/`, so **run the CLI commands below from
inside the `teaching/` folder** (that's where the CLI looks for `supabase/`).

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and sign in:
   `supabase login`.
2. Link your project: `supabase link --project-ref <your-project-ref>`
   (the ref is the `xxxx` in your Project URL `https://xxxx.supabase.co`).
3. **Edit [`supabase/functions/eis-timetable/index.ts`](supabase/functions/eis-timetable/index.ts)**:
   in the `ALLOWED_ORIGINS` set near the top, replace the existing domains with **your
   site's origin(s)** (e.g. `https://<your-username>.github.io`). Only listed origins
   get a browser-readable response.
4. Deploy it: `supabase functions deploy eis-timetable`
   This function is intentionally public (no JWT) — it's a read-only proxy.

### 5. Set up Google sign-in (admin login only)

The admin panel authenticates you with Google. The public course page needs none of this.

1. In the **Supabase dashboard → Authentication → Providers → Google**, enable it.
   (You'll paste a Client ID/secret here in a moment.)
2. In [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services →
   Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins**: add your site origin (e.g.
     `https://<your-username>.github.io`) and `http://localhost:...` if you run locally.
   - **Authorized redirect URIs**: add the callback Supabase shows you on the Google
     provider screen (`https://<your-project-ref>.supabase.co/auth/v1/callback`).
3. Copy the **Client ID** → goes into `googleClientId`. Paste the Client ID **and**
   secret back into the Supabase Google provider screen from step 5.1.
4. In the **Supabase dashboard → Authentication → URL Configuration** — this is what
   decides where you get sent *back* to after Google signs you in:
   - **Site URL**: your site's root, e.g. `https://<your-username>.github.io/`
     (or `https://<your-domain>/` if you point a custom domain at Pages). Wildcards are
     not accepted here.
   - **Redirect URLs**: one entry per origin you actually open the admin panel from —

     ```
     https://<your-username>.github.io/teaching/admin/
     https://<your-domain>/teaching/admin/       ← only if you use a custom domain
     http://localhost:5500/teaching/admin/       ← only if you run locally (5500 = VS Code Live Server)
     ```

     On a *project* site the path is `/<repo>/teaching/admin/`. These are matched
     exactly, so if you ever open the panel as `…/teaching/admin/index.html` rather than
     `…/teaching/admin/`, list that too — or use a wildcard entry
     (`https://<your-username>.github.io/teaching/admin/**`) to cover both.

   **Don't skip this step.** The admin panel asks to be returned to the page you signed
   in from, but Supabase only honours that if the URL is on the Redirect URLs list.
   Otherwise it silently ignores the request and falls back to the **Site URL** — which
   on a fresh project defaults to `http://localhost:3000`. Getting dumped on
   `localhost:3000` after clicking "Sign in" always means this list is missing the URL
   you started from.
5. The owner bootstrapped in `supabase/roles.sql` can open **Settings** in the teaching
   editor to grant Admin, Lecturer, or Student access and assign courses. Other
   accounts have no teaching access until an Admin adds them, or a Lecturer adds
   them as Students to their own courses.

### 6. Fill in `config.js`

Open **`teaching/js/config.js`** and set:

```js
supabaseUrl:     'https://<your-project-ref>.supabase.co',
supabaseAnonKey: '<your anon key>',
googleClientId:  '<your-client-id>.apps.googleusercontent.com',
catCompanion:    true,          // set false to hide the cat companion
owner: {
  name:      'Your Name',
  email:     'you@example.edu',
  cvUrl:     'https://…',        // footer CV icon
  homeUrl:   '/',                // footer home icon target
  faviconUrl:'/favicon.png',     // browser-tab icon (drop your own favicon.png at the site root)
  startYear: 2025,               // copyright range start
},
theme: {                        // default palette (a course's own colours still override)
  primary: '#3949ab', primaryDark: '#1a237e', secondary: '#ffa726',
  tertiary: '#2196F3', accent: '#9c27b0', success: '#43a047',
},
```

### 7. Commit and go live

Commit `config.js` (yes, commit it — GitHub Pages only serves committed files, and these
values are public-safe) and push. Your site is live at your Pages URL; the admin panel is
at `…/teaching/admin/`.

---

## The Class Timetable pages

`/timetable/` (public) and `/timetable/admin/` (editor) share this deployment's
Supabase project, Google client and `admins` allowlist — **there is nothing extra to
provision.**

**The dependency runs one way: `timetable/` needs `teaching/`, never the reverse.**
The timetable pages reuse teaching's `js/config.js` (so there's still one file to
configure), its `js/timetable.js` renderer, and its `admin/css/styles.css`.

Nothing under `teaching/` refers to `timetable/`, so a colleague can take `teaching/`
without it and everything works — they simply have no timetable page. (As before,
`teaching/` does still use the repo-root `css/main.css`, `favicon.png` and
`miscellaneous/catto.webp`; those are site-wide assets, not timetable ones.) Taking
`timetable/` *without* `teaching/` is the combination that doesn't work.

What they add on top of the steps above:

1. **The table.** `supabase/schema.sql` also creates `timetable_rows` (documented at the
   top of that block). If you ran the schema before this existed, re-run just that
   section — it's `create table if not exists`, so it won't disturb `course_rows`.
2. **The Edge Function is already yours.** The timetable page calls the same
   `eis-timetable` function from step 4 with the same `tId`/`cId` contract. No second
   function, no redeploy.
3. **Redirect URLs.** Add the admin panel's own URL to **Authentication → URL
   Configuration → Redirect URLs**, alongside the teaching ones:

   ```
   https://<your-username>.github.io/timetable/admin/
   https://<your-domain>/timetable/admin/          ← only with a custom domain
   http://localhost:5500/timetable/admin/          ← only if you run locally
   ```

   Missing this produces exactly the failure described in step 5.4 — sign-in silently
   dumps you on the Site URL instead of coming back here.

Google Cloud Console needs **no** changes: same origin, same OAuth client.

### Editing the timetable

`/timetable/admin/` has three tabs:

| Tab | What it controls |
|---|---|
| **Semester** | Start/end dates and the mid-semester break, with a live preview of the week counter and progress bar |
| **Header** | The info chips and action buttons above the timetable |
| **Categories** | The tab strip on the public page **and** the entries inside each one, nested right in the category's own card — no separate tab to switch to. Each category is either *class timetables* (two EIS ids) or *lecturers* (one). Drag a category by its own handle to reorder the public tabs; drag an entry by its handle to reorder the buttons inside it |

Both EIS ids come out of the public timetable URL, and a lecturer id out of the live one:

```
…/publictimetable/{timetableId}/show/programgrade/{classId}/
…/publictimetable/live/{lecturerId}
```

Every entry has an eye icon next to its Test/Delete buttons — click it to hide that
one class or lecturer from the public page without deleting it (its IDs stay saved,
dimmed in the list, ready to re-show later). **Test** previews the real EIS table
before you save, so you can confirm the ids for a class timetable entry.

Each tab saves independently and warns before you leave with unsaved changes.

---

## Getting the author's updates later

Pull improvements from the original repository:

```sh
git remote add upstream https://github.com/<original-author>/<repo>.git   # one time
git fetch upstream
git merge upstream/main            # or use GitHub's "Sync fork" button
```

If an update conflicts with your deployment settings, retain your Supabase keys,
Google client ID, site details, administrator email, and allowed origins while
merging the changes. Review the affected files before publishing.

---

## Before you share it

*(For the original author — do this once so colleagues get a smooth setup.)*

`supabase/schema.sql` is committed, but it was **reconstructed from the app code**, not
exported from a live database — the table columns are exact, but the Row-Level Security
and the admins-table key are best-effort (see the file's header). Before relying on it,
confirm it matches your real project. If you have the Supabase CLI, the authoritative
version is one command:

```sh
supabase link --project-ref <your-project-ref>
supabase db dump --schema public > supabase/schema.sql
```

Diff that against the reconstructed file, keep whichever is correct, and make sure the
write policy is keyed the way you actually gate editing. Commit it, and the guide above
works end to end.
