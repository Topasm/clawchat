# README media

The screenshots and the walkthrough GIF in the [README](../README.md) are
rendered, not hand-made, so they can be regenerated whenever the UI changes.
They live in `docs/media/` and are committed; a pull request that changes a
captured screen should regenerate them and include the new files.

```bash
npm run readme:media          # build the renderer, render the screens, stitch the GIF
npm run readme:media:shots    # only the screenshots and frames
npm run readme:media:gifs     # only the GIF (re-encode without re-driving the browser)
```

Needs `uv`, `npx playwright install chromium` and `ffmpeg` on the PATH.

## What is rendered

`e2e/readme/readme.spec.ts` opens each screen against a seeded backend and the
production build, in a light and a dark project at 1440×900, and saves
`docs/media/web-<screen>-<light|dark>.png`: Today, Inbox, Tasks with the task
pane, a project (outline and flow), Progress, the week, and a chat thread. Then
one light-only walkthrough records frames (capture something in the Inbox, open
a task, answer the agent's question) which `scripts/readme-gifs.mjs` stitches
into `docs/media/inbox-to-answer.gif` with ffmpeg. The script fails if the GIF
is over 3 MB.

The fixture is the web screenshot fixture (`e2e/visual/seed.py`, the "Berlin
conference talk" project with the browser clock pinned to March 12, 2030) plus
what the README screens need on top, added by `e2e/readme/seed.py`: a week of
events, a result waiting for review, an approved one, and the chat thread the
result came from. Nothing in `e2e/visual/` is read or written by this run, so
the regression baselines are unaffected.

## When to re-run

After a change to any captured screen, the sidebar or page shell, the theme
tokens, or either seed. Fonts differ between machines, so the images are not
compared with anything: look at them before committing.

## Three things that are not bugs

The spec changes three requests on their way to the browser; everything else
in the images is what the server returned.

- **The captured row in the walkthrough.** With no AI provider reachable the
  server marks a capture as an error within a second and stamps it with the
  real date. The spec shows that one row as a plain capture dated the fixture
  morning.
- **Today's date.** The Today screen asks the server for "today" without a
  date, and the server answers from its own clock. The spec adds the fixture
  date to that request, so the heading and the day's events read March 12, 2030.
- **The CLI session list.** The runs view lists the Codex and Claude Code
  sessions found on the machine that renders the images. The spec answers that
  request with an empty list, so nothing from the rendering machine, such as a
  project path or a session title, ends up in the README.
