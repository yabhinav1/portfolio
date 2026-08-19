# Portfolio + admin

Server-rendered portfolio with a `/admin` panel. SQLite (Node's built-in
`node:sqlite`), no build step, no framework on the frontend. Two runtime
dependencies total: `express` and `multer`.

## Run it

```bash
npm install
ADMIN_PASSWORD='pick-something-long' npm start
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin

| Env var          | Default            | Notes                                              |
|------------------|--------------------|----------------------------------------------------|
| `ADMIN_PASSWORD` | `admin`            | **Set this.** It's the only login.                  |
| `SESSION_SECRET` | random each boot   | Set it in production or logins drop on restart.     |
| `PORT`           | `3000`             |                                                     |

## What the admin does

- **Projects** — title, summary, full description, cover image, tags, live/repo
  links, year, featured flag, draft/published, sort order. Slugs auto-generate
  from the title and de-duplicate.
- **Experience** and **Skills** — same CRUD, driven by one shared form renderer.
- **Inbox** — contact-form submissions, mark read / delete.
- **Settings** — name, role, tagline, about, photo, social links, résumé URL,
  accent colour, availability badge, SEO title/description.
- **Image upload** — drops files in `uploads/`, served from `/uploads`. Images
  only, 8 MB cap. You can also paste any external URL instead.

Descriptions take a 4-rule markdown: blank line = paragraph, `**bold**`,
`[text](url)`, single newline = line break.

## Files

```
server.js        routes, auth, schema, entity specs
lib.js           escape / markdown / slugify
views/site.js    public pages
views/admin.js   admin pages
public/*.css     two stylesheets
portfolio.db     created on first run (gitignore it)
uploads/         uploaded images (gitignore it)
```

Adding a new editable section = one entry in `ENTITIES` in `server.js` plus a
`create table`. The list page, form, save, and delete all come for free.

## Deploying

Any host that runs Node 22+ and gives you a persistent disk (Fly.io, Railway,
a VPS). Put it behind HTTPS — the session cookie is `HttpOnly; SameSite=Lax`
but not `Secure`, so add `Secure` once you're on TLS. Back up `portfolio.db`
and `uploads/` together; they're the whole site.

## Known ceilings

Marked in the code with `ponytail:` comments.

- Contact-form rate limit is in-memory — resets on restart. Fine for one box.
- Markdown is 4 rules, not CommonMark. Swap in `marked` if you outgrow it.
- Single admin user, password in an env var. Add a users table if you ever
  need more than one person editing.
