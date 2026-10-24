# Changelog

## 1.4.0 (2026-10-24)

- Every call has Copy link, and the link opens the board with that call open.
- Calendar files: Add deadlines to calendar saves every upcoming deadline, and Add to calendar on a call saves just that one, each with a reminder a week before.
- Open calls whose deadline has passed move to a Deadline passed group instead of staying under Open now.
- Check NASA now asks NASA only for posts changed since the last review, and fetches post bodies only for posts still to review: a few kilobytes instead of about 2 MB. Grants.gov is asked with a simple request first, so no cross-origin preflight fails along the way.
- The capability register gains expertise and team rows from the lab's people page (C15 to C24) and contacts for C10 to C12. Contacts show only where they're set, and the call names under Used by link to the calls.
- The lab banner is served from this repository, with a transparent background so it sits cleanly in the header.
- The header says when the board was last reviewed against NASA; the To review lane says when this browser last checked.
- The redirect page for the old single-file copy uses the lab look.

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
