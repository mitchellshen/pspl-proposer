"""Browser tests for PSPL Proposer.

    pip install playwright
    python -m playwright install chromium
    python3 test/test_site.py

Serves a temporary copy of the site on localhost, stands in for NASA, Grants.gov and the
GitHub API, and checks view mode, edit mode, publishing, conflicts, downloaded copies, a
broken board.json and phone width. Screenshots go to test/output/.
"""
import functools
import json
import shutil
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "output"
SITE_URL = "https://mitchellshen.github.io/pspl-proposer/"
API_PREFIX = "https://api.github.com/repos/mitchellshen/pspl-proposer/contents/board.json"
EDIT_URL = "https://github.com/mitchellshen/pspl-proposer/edit/main/board.json"
K_CHANGES = "pspl-proposer:changes:pspl-proposer"
sys.path.insert(0, str(ROOT / "tools"))
import check_board  # noqa: E402

OUT.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix="pspl-site-"))
for name in ("index.html", "app.js", "style.css", "board.json"):
    shutil.copy(ROOT / name, work / name)
SEED_TEXT = (ROOT / "board.json").read_text(encoding="utf-8")
SEED = json.loads(SEED_TEXT)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(work)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}/"


def board_text():
    return (work / "board.json").read_text(encoding="utf-8")


def set_board(text):
    (work / "board.json").write_text(text, encoding="utf-8")


# ---- stand-ins for NASA, Grants.gov and GitHub ----
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, accept", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
BLOG = [{"id": 442128, "link": "https://science.nasa.gov/researchers/solicitations/roses-2025/", "title": {"rendered": "ROSES-25 Blog"}}]


def post(pid, date, title, html, modified=None):
    return {"id": pid, "parent": 442128, "date": date, "modified": modified or date,
            "link": f"https://science.nasa.gov/researchers/solicitations/roses-2025/post-{pid}/",
            "title": {"rendered": title}, "content": {"rendered": html}}


POSTS = [
    post(1500001, "2026-10-22T10:00:00", "Amendment 81: New Opportunity: B.9 Heliophysics Example Program",
         "<p>B.9 solicits example investigations of the solar wind.</p><p>Step-1 proposals are due December 15, 2026, and Step-2 proposals are due March 1, 2027.</p>"),
    post(1500002, "2026-10-22T09:00:00", "Amendment 82: New Opportunity: A.19 Ocean Example", "<p>Proposals are due January 20, 2027.</p>"),
    post(1497556, "2026-10-20T15:02:47", "NASA Prepares ROSES-27", "<p>ROSES-27 no later than January 2027.</p>", modified="2026-10-20T15:03:47"),
]
GG = {"errorcode": 0, "data": {"hitCount": 2, "oppHits": [
    {"id": "364001", "number": "NNH26ZDA020C", "title": "Lunar Example Cooperative Agreement Notice", "agencyCode": "NASA-HQ", "openDate": "10/22/2026", "closeDate": "02/02/2027"},
    {"id": "364002", "number": "NNH25ZDA001N-HEP", "title": "ROSES25: B.9 Heliophysics Example Program", "agencyCode": "NASA-HQ", "openDate": "10/22/2026", "closeDate": "03/01/2027"},
]}}
api = {"mode": "serve", "calls": 0, "accept": None}


def json_reply(route, body, status=200):
    if route.request.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    route.fulfill(status=status, headers={**CORS, "Content-Type": "application/json"}, body=body if isinstance(body, str) else json.dumps(body))


def nasa(route):
    json_reply(route, BLOG if "slug=" in route.request.url else POSTS)


def github_api(route):
    api["calls"] += 1
    api["accept"] = route.request.headers.get("accept")
    if api["mode"] == "fail":
        return json_reply(route, {"message": "API rate limit exceeded"}, 403)
    json_reply(route, board_text())


def pages_copy(route):
    json_reply(route, board_text())


# ---- results ----
problems, notes = [], []


def check(cond, msg):
    (notes if cond else problems).append(("ok   " if cond else "FAIL ") + msg)
    return cond


def band(pg):
    return pg.inner_text("#changesText") if pg.is_visible("#changesBand") else ""


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    def new_ctx(**kw):
        opts = dict(viewport={"width": 1280, "height": 900}, accept_downloads=True, color_scheme="light")
        opts.update(kw)
        ctx = browser.new_context(**opts)
        ctx.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("https://fonts.gstatic.com/**", lambda r: r.abort())
        ctx.route("https://science.nasa.gov/**", nasa)
        ctx.route("https://api.grants.gov/**", lambda r: json_reply(r, GG))
        ctx.route(API_PREFIX + "**", github_api)
        ctx.route(SITE_URL + "board.json**", pages_copy)
        return ctx

    def open_page(ctx, url=BASE, tag="page"):
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))
        pg.on("console", lambda m: errors.append(f"{tag}: {m.text}") if m.type == "error" and "ERR_FAILED" not in m.text and "fonts.g" not in m.text else None)
        pg.goto(url)
        return pg

    def loaded(pg):
        pg.wait_for_function("document.querySelector('#st-open') && document.querySelector('#st-open').textContent !== '—'")

    # 1. A colleague opens the board: view mode.
    ctx = new_ctx()
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
    pg = open_page(ctx, tag="view")
    loaded(pg)
    pg.wait_for_selector("#lanes .opp")
    check(pg.title() == "PSPL Proposer", "page title")
    check(pg.get_attribute("#editBtn", "aria-pressed") == "false", "opens in view mode")
    check(pg.is_hidden("#addCallBtn"), "Add a call is hidden in view mode")
    check(pg.is_hidden("#changesBand") and pg.is_hidden("#noticeBand"), "no bands on a normal first visit")
    check(pg.locator("#lanes .opp").count() == 12, "all 12 calls listed")
    pg.locator("#lanes .opp .opp-head").first.click()
    body = pg.locator("#lanes .opp.is-open .opp-body")
    check(body.locator(".stepper button").count() == 0, "no score buttons in view mode")
    check(body.locator(".stepper.readonly output").count() == 3, "scores shown read-only")
    check(body.locator(".actions").count() == 0, "no Edit, Rescore, Archive or Delete in view mode")
    pg.click("#tab-capabilities")
    check(pg.locator("#capList input[type=checkbox]").count() == 0, "no Confirmed checkboxes in view mode")
    check(pg.locator("#capList .confirm-text").count() == 17, "each capability row shows whether it's confirmed")
    check(pg.is_hidden("#addCap") and pg.is_visible("#capIntroView"), "register is read-only with a hint on how to correct it")
    pg.click("#tab-opportunities")
    pg.click("#checkNowBtn")
    pg.wait_for_selector(".lane.review .rv")
    rv = pg.locator(".lane.review")
    check(rv.locator(".view-hint").count() == 1, "To review explains what to do in view mode")
    check(rv.get_by_role("button", name="Add to board").count() == 0 and rv.get_by_role("button", name="Mark reviewed").count() == 0, "no review actions in view mode")
    check("Grants.gov: read" in rv.locator(".src-status").inner_text(), "both sources read")
    stored = json.loads(pg.evaluate(f"localStorage.getItem('{K_CHANGES}')") or "{}")
    check(not (stored.get("meta") or {}).get("checkedOn") and pg.is_hidden("#changesBand"), "checking NASA in view mode leaves nothing to publish")
    pg.screenshot(path=str(OUT / "view-desktop.png"), full_page=True)

    # 2. The maintainer turns on Edit, changes things and publishes.
    pg.click("#editBtn")
    check(pg.get_attribute("#editBtn", "aria-pressed") == "true" and pg.is_visible("#addCallBtn"), "Edit turns on edit mode")
    card = pg.locator("#opp-next-hlcas")
    if not card.locator(".opp-body").count():
        card.locator(".opp-head").click()
    a0 = SEED["opps"]["next-hlcas"]["a"]
    a1 = a0 + 1 if a0 < 3 else a0 - 1
    card.get_by_role("button", name="Raise alignment" if a1 > a0 else "Lower alignment").click()
    check("1 call" in band(pg) and "Nobody else sees it" in band(pg), "one changed call shows in the gold band")
    check(card.locator(".pill.mine").count() == 1, "the changed call is marked Changed here")
    pg.click("#tab-capabilities")
    pg.click("#cf-C8")
    check(pg.is_checked("#cf-C8") and "1 call, 1 capability row" in band(pg), "confirming a capability adds to the band")
    pg.click("#tab-opportunities")
    pg.locator(".lane.review .rv").filter(has_text="B.9 Heliophysics Example").get_by_role("button", name="Mark reviewed").click()
    check("1 NASA post reviewed" in band(pg), "a reviewed NASA post counts as a change")
    api["calls"] = 0
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    check(api["calls"] == 1 and api["accept"] == "application/vnd.github.raw+json", "publish reads the latest board through GitHub's API")
    summary = pg.inner_text("#publishSummary")
    check("12 calls and 17 capability rows" in summary, "publish summary counts the board")
    check(pg.get_attribute("#editLink", "href") == EDIT_URL, "GitHub link opens board.json in the editor")
    check(pg.is_hidden("#publishBtn") and pg.is_visible("#publishSteps"), "the three publish steps replace the button")
    pg.click("#copyBoardBtn")
    pg.wait_for_function("document.querySelector('#copyMsg').textContent.length > 0")
    check("Copied" in pg.inner_text("#copyMsg"), "copy confirms")
    text = pg.evaluate("navigator.clipboard.readText()")
    data = json.loads(text)
    check(data["opps"]["next-hlcas"]["a"] == a1, "published board has the new score")
    check(data["caps"]["C8"]["confirmed"] is True, "published board has the confirmed capability")
    check("wp:1500001" in data["nasa"]["reviewed"], "published board records the reviewed NASA post")
    check(data["checkedOn"] == SEED["checkedOn"] and data["checkNote"] == SEED["checkNote"], "a NASA check in view mode doesn't change the published note")
    check(check_board.canonical(data) == text, "published board.json is in the canonical layout")
    errs, _ = check_board.check(data)
    check(not errs, "published board.json passes tools/check_board.py" + ("" if not errs else ": " + "; ".join(errs)))
    same = [k for k in SEED["opps"] if k != "next-hlcas" and data["opps"][k] == SEED["opps"][k]]
    check(len(same) == 11, "untouched calls are byte-for-byte unchanged")
    with pg.expect_download() as dl:
        pg.click("#downloadBoardBtn")
    path = dl.value.path()
    check(dl.value.suggested_filename == "board.json" and Path(path).read_text(encoding="utf-8") == text, "download gives the same board.json")
    pg.screenshot(path=str(OUT / "publish-desktop.png"), full_page=False)

    # 3. The commit lands: the band clears and everyone sees the change.
    set_board(text)
    pg.reload()
    loaded(pg)
    check(pg.is_hidden("#changesBand"), "band clears once the site has the published board")
    other = new_ctx()
    pg2 = open_page(other, tag="second visitor")
    loaded(pg2)
    check(pg2.inner_text("#opp-next-hlcas .score") == f"{data['opps']['next-hlcas']['a'] + data['opps']['next-hlcas']['r'] + data['opps']['next-hlcas']['t']} / 8", "another visitor sees the published score")
    check(pg2.get_attribute("#editBtn", "aria-pressed") == "false", "edit mode is per browser")

    # 4. Someone else published a newer version of the same row.
    pg.click("#tab-capabilities")
    pg.click("#cf-C2")
    newer = json.loads(board_text())
    newer["caps"]["C2"]["evidence"] = "Edited by someone else."
    newer["caps"]["C2"]["updatedAt"] = "2099-01-01T00:00:00.000Z"
    set_board(check_board.canonical(newer))
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    summary = pg.inner_text("#publishSummary")
    check("nothing new to publish" in summary and "1 of your changes is older" in summary and pg.is_hidden("#publishSteps"), "an older local change doesn't overwrite a newer published one")
    pg.reload()
    loaded(pg)
    check(pg.is_hidden("#changesBand"), "the superseded change is dropped on reload")
    set_board(text)
    pg.reload()
    loaded(pg)

    # 5. GitHub's API is unavailable: publish falls back to the site's copy.
    api["mode"] = "fail"
    pg.click("#tab-capabilities")
    pg.click("#cf-C3")
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    check(pg.is_visible("#publishSteps") and "couldn't be read" not in pg.inner_text("#publishSummary"), "publish still works from the site's copy when GitHub's API refuses")
    pg.click("#publishClose")
    pg.route(BASE + "board.json**", lambda r: r.fulfill(status=500, body="down"))
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    check("couldn't be read just now" in pg.inner_text("#publishSummary"), "publish warns when it can't read the latest board")
    pg.unroute(BASE + "board.json**")
    api["mode"] = "serve"
    pg.click("#publishClose")

    # 6. Copying is blocked: the text is shown selected instead.
    pg.evaluate("() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); }")
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    pg.click("#copyBoardBtn")
    check(pg.is_visible("#publishText") and "blocked" in pg.inner_text("#copyMsg"), "blocked clipboard falls back to selected text")
    check(json.loads(pg.input_value("#publishText"))["caps"]["C3"]["confirmed"] is True, "the selectable text is the new board")

    # 7. Discard.
    pg.click("#discardBtn")
    pg.click("#discardBtn")
    check(pg.is_hidden("#changesBand"), "Discard my changes clears the band")
    pg.click("#tab-capabilities")
    check(pg.is_checked("#cf-C3") == bool(SEED["caps"]["C3"]["confirmed"]), "discarded change is gone")

    # 8. Add a call from a NASA post, in edit mode.
    pg.click("#tab-opportunities")
    lunar = pg.locator(".lane.review .rv").filter(has_text="Lunar Example")
    lunar.get_by_role("button", name="Add to board").click()
    check(pg.is_visible("#addPanel") and "Lunar Example" in pg.input_value("#a-title"), "Add to board prefills the form")
    pg.click("#a-save")
    pg.wait_for_selector("form.opp-form")
    pg.locator("form.opp-form").get_by_role("button", name="Save changes").click()
    check("1 call" in band(pg) and pg.locator(".opp", has_text="Lunar Example").count() == 1, "a new call is added locally")
    check(pg.locator(".lane.review .rv").filter(has_text="Lunar Example").count() == 0, "the post leaves To review once added")
    pg.click("#discardBtn")
    pg.click("#discardBtn")

    # 9. Phone width, view and edit with the publish steps open.
    phone = new_ctx(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pp = open_page(phone, tag="phone")
    loaded(pp)
    check(pp.evaluate("document.documentElement.scrollWidth") <= 390, "no sideways scroll on a phone (view)")
    pp.screenshot(path=str(OUT / "view-phone.png"), full_page=False)
    pp.click("#editBtn")
    pp.locator("#lanes .opp .opp-head").first.click()
    opened = pp.locator("#lanes .opp.is-open")
    raise_r = opened.get_by_role("button", name="Raise readiness")
    (raise_r if raise_r.is_enabled() else opened.get_by_role("button", name="Lower readiness")).click()
    pp.click("#publishBtn")
    pp.wait_for_selector("#publishPanel:not([hidden])")
    check(pp.evaluate("document.documentElement.scrollWidth") <= 390, "no sideways scroll on a phone (publish steps)")
    pp.screenshot(path=str(OUT / "publish-phone.png"), full_page=False)

    # 10. Dark theme.
    dark = new_ctx(color_scheme="dark")
    pd = open_page(dark, tag="dark")
    loaded(pd)
    pd.locator("#lanes .opp .opp-head").first.click()
    bg = pd.evaluate("getComputedStyle(document.body).backgroundColor")
    check(bg == "rgb(14, 19, 26)", "dark theme follows the computer setting")
    pd.screenshot(path=str(OUT / "view-dark.png"), full_page=False)

    # 10b. A NASA check in edit mode on a later day goes into the published note.
    later = new_ctx()
    later.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
    pl = later.new_page()
    pl.on("pageerror", lambda e: errors.append(f"later: {e}"))
    pl.clock.set_fixed_time("2026-10-30T12:00:00")
    pl.goto(BASE)
    loaded(pl)
    pl.click("#editBtn")
    pl.click("#checkNowBtn")
    pl.wait_for_function("document.querySelector('#checkNowBtn').textContent === 'Check NASA now'")
    pl.click("#tab-capabilities")
    pl.click("#cf-C4")
    pl.click("#publishBtn")
    pl.wait_for_selector("#publishPanel:not([hidden])")
    pl.click("#copyBoardBtn")
    pl.wait_for_function("document.querySelector('#copyMsg').textContent.length > 0")
    d2 = json.loads(pl.evaluate("navigator.clipboard.readText()"))
    check(d2["checkedOn"] == "2026-10-30" and d2["checkNote"].startswith("Last checked Oct 30, 2026 with Check NASA now"), "a NASA check in edit mode on a later day updates the published note")

    # 11. A downloaded copy loads the latest board from the site and says it's a copy.
    copydir = Path(tempfile.mkdtemp(prefix="pspl-copy-"))
    for name in ("index.html", "app.js", "style.css"):
        shutil.copy(work / name, copydir / name)
    fc = new_ctx()
    pf = open_page(fc, "file://" + quote(str(copydir / "index.html")), tag="file copy")
    loaded(pf)
    check(pf.is_visible("#noticeBand") and "downloaded copy" in pf.inner_text("#noticeText"), "a downloaded copy says so")
    check(pf.get_attribute("#noticeText a", "href") == SITE_URL, "and links to the shared board")
    check(pf.locator("#lanes .opp").count() == 12, "a downloaded copy still shows the live board")

    # 12. A broken board.json: returning visitors see their last good copy; new ones get a clear message.
    set_board('{"format": "pspl-proposer/1", "opps": {},}')
    pg.reload()
    loaded(pg)
    check(pg.is_visible("#noticeBand") and "copy this browser kept" in pg.inner_text("#noticeText"), "broken board: a returning visitor sees the kept copy")
    fresh = new_ctx()
    pn = open_page(fresh, tag="new visitor, broken board")
    pn.wait_for_selector("#lanes .empty")
    msg = pn.inner_text("#lanes .empty")
    check("Couldn't load the board" in msg and "revert" in msg, "broken board: a new visitor is told what to do")
    set_board(SEED_TEXT)

    browser.close()

server.shutdown()
shutil.rmtree(work, ignore_errors=True)
real_errors = [e for e in errors if "Failed to load resource" not in e]
check(not real_errors, "no script errors" + ("" if not real_errors else ": " + " | ".join(real_errors[:5])))
print("\n".join(notes + problems))
print(f"\n{len(notes)} passed, {len(problems)} failed")
sys.exit(1 if problems else 0)
