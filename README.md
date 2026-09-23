<div align="center">
  <img src="miscellaneous/profile.jpg" width="140" alt="Bredli Plaku">
  <h1>Bredli's Website</h1>
  <p>Personal website, teaching materials and academic tools.</p>
  <p>
    <a href="https://bredliplaku.com/"><strong>Website</strong></a>
    &nbsp;·&nbsp;
    <a href="teaching/README.md"><strong>Syllabase reference</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/bredliplaku/attendance/blob/main/README.md"><strong>Stando reference</strong></a>
    &nbsp;·&nbsp;
    <a href="LICENSE">MIT license</a>
  </p>
</div>

---

## Pages

| Page | Purpose |
|---|---|
| [**Home**](index.html) | Personal links and access to the site's tools |
| [**Syllabase**](teaching/) | Course materials, editing, account permissions and lecturer websites |
| [**Timetable**](timetable/) | Class and lecturer schedules, with a separate editor |
| [**Stando**](https://bredliplaku.com/attendance/) | Smart Attendance replaces paper-based attendance with NFC |
| [**Exam portal**](exam_form/) | Exam access and administration |
| [**Glyph**](exam_stamp/) | Adds student names to exam PDFs and downloads the copies as a ZIP |
| [**Projects**](projects/) | Projects and userscripts |

The site is hosted on **GitHub Pages** and uses HTML, CSS and JavaScript directly.
**Supabase** stores teaching and timetable data and handles Google sign-in.
Course pages are public; editing requires an account with the right permissions.


## 🛠️ Shared files

Each tool has its own folder. These files are shared or used by the home page:

| File or folder | Used for |
|---|---|
| [css/main.css](css/main.css) | Shared colors, components and public course styles |
| [css/styles.css](css/styles.css), [js/scripts.js](js/scripts.js) | Home page layout and behavior |
| [teaching/js/config.js](teaching/js/config.js) | Supabase connection, Google client ID, branding and theme |
| [miscellaneous/](miscellaneous/) | Site assets |

**When changing shared code:**

- Keep configuration and helper scripts before page scripts in the HTML.
- Load page-specific styles after shared styles.
- Update every reference when renaming a file. Timetable also uses teaching's
  timetable renderer and editor stylesheet.
- Publish renamed files together with the HTML that loads them.

> **Keep `teaching/embed.js` at its published address.** Uploaded lecturer files
> depend on it. If the application moves, keep a compatible loader at the old
> address or replace each uploaded file.
