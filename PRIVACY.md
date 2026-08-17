# Socialfix — Privacy Policy

_Last updated: August 15, 2026_

Socialfix is a browser extension that adds bulk-action tools, feed cleanup,
and keyboard shortcuts to social sites you are already logged into
(instagram.com, youtube.com, x.com, reddit.com).

## The short version

Nothing you do ever leaves your device. Socialfix has no backend server, no
analytics, no telemetry, no error reporting, and no account system. It never
transmits, sells, or shares any data with anyone — including the developer.
It never sees or stores your passwords and contains no login code of any
kind. The only data it touches is stored locally in your browser, described
below.

## What the extension stores locally

Socialfix keeps a small amount of data in your browser's local extension
storage (`chrome.storage.local`), on your device only:

- **Daily action counters** — how many bulk actions (unfollows, unlikes,
  unsaves, removals) ran today, used to enforce the extension's built-in
  daily safety caps.
- **Cached lists for Instagram panels** — a cached copy of your own
  followers/following comparison (the "doesn't follow you back" panel) and a
  snapshot of your own follower list (the "see who unfollowed" panel), so
  reopening those panels doesn't re-scan every time. These caches contain
  usernames from your own follower/following lists.
- **Your own username** (Instagram), cached so the extension can recognize
  your own profile page.
- **UI preferences** — the width/height you dragged the Instagram
  Followers/Following window to (two numbers plus a flag saying whether the
  height could be applied). The toolbar popup also remembers which of its
  tabs you last viewed, in the popup page's own local storage.

Because these caches include usernames, they technically count as "user
data" under Chrome Web Store definitions even though they are processed and
stored **only on your device**. This data never leaves your browser, is used
solely to show you the panels described above, and is deleted when you
uninstall the extension (or clear it from the extension's storage).

## Network requests

Socialfix runs only on the sites listed above and only talks to those same
sites, using your existing logged-in session — the same way the site's own
page does (for example, unfollowing on Instagram calls Instagram's own
endpoint; unsaving on Reddit calls Reddit's own endpoint). No request is ever
sent to any third party or to the extension's developer.

## Permissions

- **storage** — for the local counters, caches and UI preferences described
  above.
- **Site access to instagram.com, youtube.com, x.com, reddit.com** — required
  to add the extension's buttons/panels to those pages and perform the
  actions you explicitly trigger. The extension takes no action on its own;
  every mutating action is user-initiated and rate-limited.

## Changes

If this policy changes, the updated version will be published at this same
URL with a new "Last updated" date.

## Contact

Questions: open an issue on the project repository, or email
saahilshah178@gmail.com.
