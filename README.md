<div align="center">
  <img src="miscellaneous/profile.jpg" width="140" alt="Bredli Plaku">
  <h1>Bredli's Website</h1>
  <p>Personal website, teaching materials and academic tools.</p>
  <p>
    <a href="https://bredliplaku.com/"><strong>Website</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/bredliplaku/syllabase/blob/main/README.md"><strong>Syllabase reference</strong></a>
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
| [**Home**](https://bredliplaku.com/) | Personal links and access to the site's tools |
| [**Syllabase**](https://bredliplaku.com/teaching/) | Course materials, timetable, account permissions and lecturer websites |
| [**Stando**](https://bredliplaku.com/attendance/) | Smart Attendance replaces paper-based attendance with NFC |
| [**Exam portal**](exam_form/) | Exam access and administration |
| [**Glyph**](exam_stamp/) | Adds student names to exam PDFs and downloads the copies as a ZIP |
| [**Projects**](projects/) | Projects and userscripts |

Syllabase and Stando are maintained in separate repositories:
[syllabase](https://github.com/bredliplaku/syllabase) and
[attendance](https://github.com/bredliplaku/attendance).

The site is hosted on **GitHub Pages** and uses HTML, CSS and JavaScript directly.


## 🛠️ Shared files

Each tool has its own folder. These files are shared or used by the home page:

| File or folder | Used for |
|---|---|
| [css/main.css](css/main.css) | Shared colors and components |
| [css/styles.css](css/styles.css), [js/scripts.js](js/scripts.js) | Home page layout and behavior |
| [miscellaneous/](miscellaneous/) | Site assets |

**When changing shared code:**

- Keep helper scripts before page scripts in the HTML.
- Load page-specific styles after shared styles.
- Update every reference when renaming a file.
- Publish renamed files together with the HTML that loads them.