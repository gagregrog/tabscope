# Tabscope

Fuzzy-find your open tabs by title or URL, in a telescope.nvim-style picker. Works in Brave, Chrome and other Chromium browsers.

## Install

1. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Press **⌘⇧F** (macOS) or **Ctrl+Shift+F**. To change the hotkey, go to `brave://extensions/shortcuts`.

## Keys

| Key | Action |
| --- | --- |
| type | fuzzy filter (space-separated terms must all match; an uppercase letter makes it case-sensitive) |
| `↓` `^n` `^j` / `↑` `^p` `^k` | move selection |
| `PgDn` / `PgUp` | move by 10 |
| `⏎` / click | switch to the tab (and focus its window) |
| `^d` / `⌥d` | close the selected tab |
| `^u` | clear the query |
| `esc` / `^c` / hotkey again | quit |

With an empty query, tabs are listed most recently used first and the current tab goes last, so the hotkey followed by `⏎` takes you back to your previous tab.

## How it works

- The hotkey injects `overlay.js` into the current page. It adds a full-screen iframe of `palette.html`, so page CSS and scripts can't interfere with the picker.
- On pages that extensions can't script (`brave://`, the new tab page, the Web Store, PDFs), the picker opens as the toolbar popup instead. Clicking the toolbar icon opens it there too.
- `fuzzy.js` is an fzf-style scorer. It gives bonuses for matches at word boundaries, at camelCase humps and in consecutive runs, and penalties for gaps.
