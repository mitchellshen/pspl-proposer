# Changelog

## 1.1.0 (2026-10-23)

- One shared board on GitHub Pages. The board moved into `board.json` in this repository, so every change is a commit with a history.
- The page opens read-only. **Edit** turns on editing in one browser; changes stay there until published.
- **Publish changes** merges your changes into the latest committed board and walks through committing it on GitHub, with a download for people without access.
- Saved copies of the page load the latest board from the site and say they're copies.
- If `board.json` can't be read, returning visitors see their last good copy and new visitors are told how to fix it.
- `tools/check_board.py` and the **Check board.json** action check every change.

## 1.0.0 (2026-10-23)

- Single-file edition for a shared OneDrive folder, with Check NASA now, AI suggestions through copy-and-paste prompts, and Save updated file.
