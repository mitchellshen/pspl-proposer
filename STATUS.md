# Status: PSPL Proposer
_Updated: 2026-11-24_

**State:** 1.5.1 is live at https://mitchellshen.github.io/pspl-proposer/ with NASA and NSF calls; the board hasn't been published since Oct 24.

## Done recently
- 1.5.1 (#31): fixes from a safety review. Publishing from the site's copy now warns that it can trail a new commit (#14), open tabs share unpublished changes instead of overwriting them, and CSV exports keep formula-like cells as text.
- 1.5.0 (#29): NSF calls from Grants.gov, with a watch list of NSF programs. Every call has a funder, calls accepted anytime show Anytime, and a NASA/NSF filter appears once NSF calls are on the board.
- Filed #30 (idea: server-side check of new calls) and #32 (bug: capability-ID collision).

## Next
1. Confirm or remove the unconfirmed register rows (#10), then rescore the calls (#11).
2. Prepare the board for the ROSES-27 release (#12).

## Waiting on Mitchell
- 15 items wait under To review on the live board: the seven watched NSF programs, plus NASA posts and listings since Oct 23. Someone in edit mode adds the ones that fit and publishes.
- Decide who can publish (#17), and whether the weekly Claude check moves to this board (#9).
- Release tags v1.1.0 to v1.5.1 on GitHub's Releases page (#15); Claude's session can't push tags.

## Known issues
- Two people adding capability rows before either publishes can get the same ID, and one row is lost (#32).
- Changes are ordered by each computer's clock, so a computer with a wrong clock can win or lose a merge it shouldn't.
- Changes to an NSF call already on the board aren't flagged.

## Run / test
- `python3 test/test_site.py` (Playwright, 119 checks) and `python3 tools/check_board.py`
- GitHub Pages deploys main; the "Check board.json" action checks every push and pull request.
