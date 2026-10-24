# Changelog

## 1.3.1 (2026-10-24)

- The header buttons stay on the right when they wrap onto their own line on medium-width screens.

## 1.3.0 (2026-10-24)

- The Space Physics at Princeton logo next to the title, and as the browser tab and home-screen icon.
- How it works and the publish steps now say who can change the board: anyone can try changes in their own browser, only people added to the repository can commit, and everyone else's changes go to the maintainer to approve.

## 1.2.0 (2026-10-23)

- Styled after Space Physics at Princeton: the lab's banner in a black header with the Princeton-orange rule, a charcoal section bar with an orange marker, Montserrat headings with the short orange bar, Roboto text and a matching footer.
- The calibration facility rows (C4 to C6) now follow the lab's calibration-system page, and a new row, C14, covers the facility's control system and 1 Hz logging.

## 1.1.0 (2026-10-23)

- One shared board on GitHub Pages. The board moved into `board.json` in this repository, so every change is a commit with a history.
- The page opens read-only. **Edit** turns on editing in one browser; changes stay there until published.
- **Publish changes** merges your changes into the latest committed board and walks through committing it on GitHub, with a download for people without access.
- Saved copies of the page load the latest board from the site and say they're copies.
- If `board.json` can't be read, returning visitors see their last good copy and new visitors are told how to fix it.
- `tools/check_board.py` and the **Check board.json** action check every change.

## 1.0.0 (2026-10-23)

- Single-file edition for a shared OneDrive folder, with Check NASA now, AI suggestions through copy-and-paste prompts, and Save updated file.
