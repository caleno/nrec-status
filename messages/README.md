# Messages

Every `.md` or `.txt` file in this folder is published on the status page
when it is pushed to `main`. Files starting with `_` (like the templates) and
this README are ignored.

## Format

```markdown
---
title: Planned maintenance of the dashboard
type: maintenance          # news | info | important | event | maintenance | incident
date: 2026-12-01 10:00     # when it is published (Oslo time); defaults to the date in the file name
start: 2026-12-09 12:00    # maintenance window / incident start (optional)
end: 2026-12-09 16:00      # (optional)
regions: [bgo, osl]        # optional
services: [dashboard, api] # optional, see "services" in config/site.json
status: resolved           # optional: marks an incident resolved or maintenance completed
draft: true                # optional: not published
---

The message itself, in Markdown. **Bold**, [links](https://docs.nrec.no),
lists, and emoji either typed directly 🎉 or as shortcodes :tada:.
```

- `.md` files are rendered as GitHub-flavoured Markdown.
- `.txt` files are shown as plain text (links and :emoji: shortcodes still work).
- Name files `YYYY-MM-DD-short-name.md` so they sort by date.
- Times without a time zone are Oslo time.
- Maintenance is shown as *Scheduled*, *In progress* or *Completed* based on
  `start` and `end`, and appears under **Active now** until it ends.

For incidents that need updates as they unfold, an issue is often easier:
each comment becomes an update. See `.github/ISSUE_TEMPLATE/`.
