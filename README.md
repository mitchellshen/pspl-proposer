# PSPL Proposer

NASA and NSF calls ranked by how well they fit what the Princeton Space Physics Lab can build, calibrate, fly and analyze.

**Open the board: https://mitchellshen.github.io/pspl-proposer/**

It works in Edge, Chrome, Safari and Firefox on Windows and Mac. There's nothing to install, and reading the board needs no account.

## One board for everyone

The whole board (the calls, their scores and the lab's capability register) lives in one file, [`board.json`](board.json). The page reads it every time it opens, so everyone sees the same board, and every change to it is a commit here: the history shows who changed what and when, and any change can be reverted.

Bookmark the page rather than saving a copy. A saved copy still loads the latest board from the site and says it's a copy.

To point someone at one call, open it and choose **Copy link**; the link opens the board with that call open. **Add deadlines to calendar** saves every upcoming deadline as calendar events (Outlook, Apple Calendar, Google Calendar), each with a reminder a week before.

## Who can change the board

Anyone can choose **Edit** on the page and try changes, including correcting or confirming capabilities, but those changes stay in their own browser. Nothing reaches the shared board until it's committed to `board.json` here, and only the owner and the collaborators they add (**Settings → Collaborators**) can commit. Anyone else who publishes gets GitHub's **Propose changes** instead, which opens a pull request for the owner to approve, or they can download `board.json` and send it on.

To review even collaborators' changes before they go live, add a ruleset for `main` that requires a pull request (**Settings → Rulesets**).

## Changing the board

1. Open the board and choose **Edit** at the top. Edit mode applies to that browser only.
2. Make your changes. They stay in your browser, counted in a gold band at the top, until you publish them.
3. Choose **Publish changes** and follow its three steps: copy the new board, open `board.json` here on GitHub, select everything and paste over it, then commit (or propose the change, without write access).
4. The site picks up the commit within a few minutes.

No write access? Choose **Download board.json** in the same band and send the file to whoever looks after the board.

Publishing starts from the latest committed `board.json` and only adds what you changed, so two people editing different rows don't overwrite each other. When both changed the same row, the more recent edit wins and the page says so.

Small fixes can also be made directly in `board.json` on GitHub. The **Check board.json** action checks every commit; if a commit breaks the file, people who visited before see their last good copy, new visitors see a message, and reverting the commit fixes it.

The site is public: anyone with the address can read the board. Keep budgets, proposal plans that aren't public yet and reviewer comments off the board.

## Checking for new calls

**Check for new calls** reads NASA's ROSES blog, where NASA posts new program elements, amendments and corrections, and NASA's and NSF's listings on Grants.gov, straight from the visitor's browser. It asks NASA only for posts changed since the last review. Posts and listings that aren't on the board or reviewed yet wait under **To review**. In edit mode, add the ones that fit, mark the rest reviewed, and publish.

NSF's own site can't be read from the page, but NSF lists all of its open funding opportunities on Grants.gov, so one request brings them all. The check watches the NSF programs that fit the lab (GEO Core, MPS Astro, MPS Physics, MRI, Mid-scale Research Infrastructure, CAREER and the AGS postdoctoral fellowships) and any listing whose title names a lab topic such as geospace, heliophysics, space weather or plasma; their funding and award sizes come from each listing's Grants.gov record. Other NSF listings posted since the NSF check began fold under **Other NSF listings**. The watch list is `NSF_WATCH` in `app.js`.

Many NSF programs now accept proposals anytime. Grants.gov marks those with a placeholder close date decades away; the page shows them as **Anytime**, scores their Timing 2 and leaves them out of calendar files.

Every call has a funder: NASA, NSF or another funder (calls saved before 1.5.0 have none and count as NASA's). Calls from other funders, such as DoD or ESA, can be added by hand with **Add a call**.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The page. Plain HTML, JavaScript and CSS with no build step. |
| `assets/` | The Space Physics at Princeton banner, logo and icons. |
| `board.json` | The board: calls, scores, the capability register, and the NASA posts and NSF listings already reviewed. |
| `tools/check_board.py` | Checks `board.json`; `--format` tidies a hand-edited file into the layout the page writes. |
| `test/test_site.py` | Browser tests (view and edit mode, publishing, conflicts, NSF calls, saved copies, a broken board, phone width). |
| `extras/PSPL Proposer.html` | A one-line page that sends anyone opening the old single-file version to the site. Put it where that file used to be, such as the shared OneDrive folder. |

## Setup (once)

In this repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.** The site is live a minute or two later.

## Running the checks locally

```sh
python3 tools/check_board.py
pip install playwright
python -m playwright install chromium
python3 test/test_site.py
```

The tests serve a temporary copy of the site and stand in for NASA, Grants.gov and GitHub, so they don't touch the live board. They run on a fixed date, so the board's own deadlines don't age them. Screenshots land in `test/output/`.

Version history is in [CHANGELOG.md](CHANGELOG.md).
