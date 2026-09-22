# Teaching roles upgrade

## Apply to the existing project

1. Open the **existing** Supabase project → **SQL Editor**.
2. Open [`roles.sql`](roles.sql) and set `teaching.global_admin_email` at the top
   to your Google sign-in email. This is the only owner email setting in the file.
3. Run `roles.sql` in full. Do **not** recreate the project or re-run
   the original schema to upgrade an existing installation.
4. Publish the updated teaching files together, then reload `/teaching/admin/`.
5. Sign in with the email you configured and open **Settings** next to your name.
   Add each person's Google sign-in email and role, select their courses, and
   save. Names come from Google automatically. You can add people before their
   first sign-in; their email is shown until their Google name is available.

If roles are already installed, rerun the updated `roles.sql` only. It keeps
existing accounts, assignments, and professor bindings, and replaces manually
entered names with Google names. No invitation email is sent.

For the first upgrade, the configured email must already exist in `public.admins`.
When moving to another deployment, change the setting at the top of `roles.sql`
to that deployment's administrator email. Rerunning the upgrade preserves an
existing global admin; changing the setting does not transfer ownership.
The upgrade stops without making changes if it cannot establish a global admin.

Apply the migration **before** publishing the new editor. The new editor reports
a missing upgrade and refuses to operate without its database permissions.
No service key, new OAuth client, Edge Function, or public configuration change
is required. Apply the SQL to your hosted project as part of deployment.

## Permissions

| Account | Course access | Editable content | Course actions | Account settings |
|---|---|---|---|---|
| Global admin | All | Everything | Create, archive, restore, delete | Manage roles and assignments |
| Admin | All | Everything | Create, archive, restore, delete | None |
| Lecturer | Assigned courses | Everything except Course Identity, Dates, and other professors | Archive | None |
| Student / TA | Assigned courses | Modules, Projects, Announcements | None | None |

Restricted fields remain visible, grey, and disabled. Students can open the
other tabs to read them. A course's active and archived offerings have separate
assignments. Archiving and restoring move the assignments with the course.
Removing access or changing a role takes effect on the next database write,
including in an already open session; reload the page to refresh its controls.

Administrators have automatic access to all courses, including future courses,
so they do not need course checkboxes. The Settings screen cannot remove or
demote the global administrator, or create another global administrator.

## Professor matching

For a lecturer, the professor name must match their first recorded Google
account name. Matching ignores case, common academic titles such as `Prof.`
and `Dr.`, and repeated whitespace.
Names come from Google's server-held identity record, not editable browser
state or Supabase user metadata. Duplicate matching professor names in one
course grant no ownership until an admin resolves the ambiguity.

When the lecturer signs in, the database binds the matching professor record
to their course assignment. They may edit that record's name, profile URL,
and photo URL; they cannot add, remove, or renumber the professor roster.
The binding survives their own name edits and course archiving. Display names
refresh from Google, but the first verified name remains fixed for ownership
matching, so renaming a Google profile cannot claim another professor record.
Changing that professor's name as an administrator, changing the account's role,
or removing its assignment clears the binding. To establish a fresh match,
the professor name must match that first recorded Google name; then reload.

## Compatibility and enforcement

- `course_rows` keeps its existing columns and public read behavior. Content
  saves use one database transaction, which validates every original and new
  row before any write. Course moves and deletions are also atomic.
- Existing `admins` entries become teaching Admins, with the configured owner
  becoming Global admin. The old `admins` table and timetable policies stay in
  place. **These Settings manage teaching access only:** they do not grant or
  revoke access to the separate timetable admin panel.
- Role and assignment tables are inaccessible to direct browser writes. Only
  the global-admin RPCs can change them. Direct `course_rows` writes remain
  available to full admins; restrictive RLS blocks limited accounts even if an
  older permissive write policy exists. Checked RPCs are the only write path
  for lecturers and students.
- A revoked account is retained as disabled, so rerunning the migration cannot
  revive an old teaching administrator. The migration can be rerun safely.
- Client-side controls are convenience only. Altering the page with Inspect
  Element, changing JavaScript variables, or calling the API directly does not
  bypass database authorization. Course content is also escaped/sanitized on
  both the public site and editor to prevent stored script injection.

Do not re-run old `schema.sql` after this upgrade: it defines the original
allowlist policies. For a fresh installation, run `schema.sql` first and then
`roles.sql`. Future teaching accounts should be managed in Settings.

The database approach follows Supabase's [database functions](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
and [provider identities](https://supabase.com/docs/guides/auth/identities) guidance.
