"""Browser tests for PSPL Proposer.

    pip install playwright
    python -m playwright install chromium
    python3 test/test_site.py

Serves a temporary copy of the site on localhost, stands in for NASA, Grants.gov (NASA and NSF
listings) and the GitHub API, and checks view mode, edit mode, publishing, conflicts, NSF calls,
downloaded copies, a broken board.json and phone width. Pages run on a fixed date (FIXED_NOW)
unless a test sets its own, so the board's deadlines don't age the tests. Screenshots go to
test/output/.
"""
import functools
import json
import shutil
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "output"
SITE_URL = "https://mitchellshen.github.io/pspl-proposer/"
FIXED_NOW = "2026-10-25T12:00:00"
API_PREFIX = "https://api.github.com/repos/mitchellshen/pspl-proposer/contents/board.json"
EDIT_URL = "https://github.com/mitchellshen/pspl-proposer/edit/main/board.json"
K_CHANGES = "pspl-proposer:changes:pspl-proposer"
sys.path.insert(0, str(ROOT / "tools"))
import check_board  # noqa: E402

OUT.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix="pspl-site-"))
for name in ("index.html", "app.js", "style.css", "board.json"):
    shutil.copy(ROOT / name, work / name)
shutil.copytree(ROOT / "assets", work / "assets")
SEED_TEXT = (ROOT / "board.json").read_text(encoding="utf-8")
SEED = json.loads(SEED_TEXT)
# Rows still to confirm, so a click on Confirmed ticks it (the board's confirmed rows change over time).
UNCONFIRMED = sorted((k for k, c in SEED["caps"].items() if not c.get("confirmed")), key=lambda k: (k[0], int(k[1:])))
ROW_A, ROW_B = UNCONFIRMED[0], UNCONFIRMED[1]


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


def nsf_hit(oid, number, title, opened, closes, cfdas):
    return {"id": oid, "number": number, "title": title, "agencyCode": "NSF", "agency": "U.S. National Science Foundation",
            "openDate": opened, "closeDate": closes, "oppStatus": "posted", "docType": "synopsis", "cfdaList": cfdas}


# Shaped like Grants.gov's answers for NSF in November 2026. A close date in 2076 is how Grants.gov
# marks a call that accepts proposals anytime.
NSF_HITS = [
    nsf_hit("363684", "26-516", "Geosciences Core Research: Atmospheric, Geospace, Earth and Ocean Sciences (GEO Core)", "08/21/2026", "10/27/2076", ["47.050"]),
    nsf_hit("363620", "26-522", "MPS Astronomical Sciences Research Programs (MPS Astro)", "08/17/2026", "10/07/2076", ["47.049"]),
    nsf_hit("364243", "27-500", "Major Research Instrumentation Program: (MRI)", "11/06/2026", "01/29/2027", ["47.041", "47.049", "47.050"]),
    nsf_hit("343875", "22-639", "Atmospheric and Geospace Sciences Postdoctoral Research Fellowships (AGS-PRF)", "10/01/2022", "10/07/2076", ["47.050"]),
    nsf_hit("330001", "22-586", "Faculty Early Career Development Program (CAREER)", "04/19/2022", "07/28/2027", ["47.041", "47.049"]),
    nsf_hit("364400", "26-599", "Space Weather Example Research (SWER)", "09/01/2026", "03/01/2027", ["47.050"]),
    nsf_hit("351111", "24-547", "Plant Genome Research Program", "02/17/2024", "", ["47.074"]),
    nsf_hit("300001", "PD-98-1331", "Sociology", "03/06/2009", "10/15/2076", ["47.075"]),
    nsf_hit("364500", "27-502", "Example Biology Research &amp; Training", "11/20/2026", "03/15/2027", ["47.074"]),
]
ANYTIME = "Proposals accepted anytime"
NSF_DETAILS = {
    "363684": {"responseDateDesc": ANYTIME, "estimatedFunding": "110000000", "numberOfAwards": "350", "awardCeiling": "none", "awardFloor": "none",
               "fundingDescLinkUrl": "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf26516",
               "synopsisDesc": "<p>The&nbsp;NSF Geosciences Research solicitation supports foundational research in three programs: Atmospheric and Geospace Sciences (AGS), Earth Sciences and Ocean Sciences.</p>"},
    "363620": {"responseDateDesc": ANYTIME, "estimatedFunding": "100000000", "awardCeiling": "none", "awardFloor": "none",
               "fundingDescLinkUrl": "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf26522", "synopsisDesc": "<p>Astronomical Sciences Core Research, Technology &amp; Instrumentation, and Innovations.</p>"},
    "364243": {"estimatedFunding": "50000000", "awardCeiling": "4000000", "awardFloor": "100000",
               "fundingDescLinkUrl": "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf27500", "synopsisDesc": "<p>The Major Research Instrumentation (MRI) Program increases access to multi-user instrumentation.</p>",
               "applicantEligibilityDesc": "Institutions of Higher Education acting on behalf of their faculty members."},
    "343875": {"responseDateDesc": ANYTIME, "estimatedFunding": "2000000", "awardFloor": "202000", "fundingDescLinkUrl": "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf22639", "synopsisDesc": "<p>AGS Postdoctoral Research Fellowships.</p>"},
    "330001": {"estimatedFunding": "250000000", "awardFloor": "400000", "fundingDescLinkUrl": "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf22586", "synopsisDesc": "<p>CAREER awards for early-career faculty.</p>"},
    "364400": {"estimatedFunding": "5000000", "fundingDescLinkUrl": "http://example.com/elsewhere", "synopsisDesc": "<p>Example space weather research.</p>"},
}
api = {"mode": "serve", "calls": 0, "accept": None}
gg_mode = {"nsf": "serve"}




def json_reply(route, body, status=200):
    if route.request.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    route.fulfill(status=status, headers={**CORS, "Content-Type": "application/json"}, body=body if isinstance(body, str) else json.dumps(body))


nasa_log, gg_log, detail_log = [], [], []


def nasa(route):
    """Behaves like WordPress: honours include, modified_after and _fields."""
    url = route.request.url
    nasa_log.append(url)
    q = parse_qs(urlparse(url).query)
    if "slug" in q:
        return json_reply(route, BLOG)
    posts = POSTS
    if "include" in q:
        ids = {int(x) for x in q["include"][0].split(",")}
        posts = [x for x in posts if x["id"] in ids]
    if "modified_after" in q:
        posts = [x for x in posts if x["modified"] >= q["modified_after"][0]]
    if "_fields" in q:
        keep = set(q["_fields"][0].split(","))
        posts = [{k: v for k, v in x.items() if k in keep} for x in posts]
    json_reply(route, posts)


def grants(route):
    req = route.request
    if req.method == "OPTIONS":
        return json_reply(route, GG)
    gg_log.append(req.headers.get("content-type", ""))
    try:
        body = json.loads(req.post_data or "{}")
    except ValueError:
        body = {}
    if "fetchOpportunity" in req.url:
        oid = str(body.get("opportunityId", ""))
        detail_log.append(oid)
        hit = next((x for x in NSF_HITS if x["id"] == oid), None)
        syn = NSF_DETAILS.get(oid)
        if not (hit and syn):
            return json_reply(route, {"errorcode": 0, "data": {}})
        return json_reply(route, {"errorcode": 0, "data": {"id": int(oid), "opportunityNumber": hit["number"], "synopsis": syn,
                                                          "cfdas": [{"cfdaNumber": c} for c in hit["cfdaList"]]}})
    if body.get("agencies") == "NSF":
        if gg_mode["nsf"] == "fail":
            return json_reply(route, {"message": "unavailable"}, 500)
        return json_reply(route, {"errorcode": 0, "data": {"hitCount": len(NSF_HITS), "oppHits": NSF_HITS}})
    json_reply(route, GG)


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

    def new_ctx(banner=True, **kw):
        opts = dict(viewport={"width": 1280, "height": 900}, accept_downloads=True, color_scheme="light")
        opts.update(kw)
        ctx = browser.new_context(**opts)
        ctx.clock.set_fixed_time(FIXED_NOW)
        ctx.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("https://fonts.gstatic.com/**", lambda r: r.abort())
        ctx.route("https://science.nasa.gov/**", nasa)
        ctx.route("https://api.grants.gov/**", grants)
        ctx.route(API_PREFIX + "**", github_api)
        ctx.route(SITE_URL + "board.json**", pages_copy)
        ctx.route("https://spacephysics.princeton.edu/**", lambda r: r.abort())
        if not banner:
            ctx.route(BASE + "assets/spp-banner.png", lambda r: r.abort())
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
    pg.wait_for_function("document.querySelector('.lab-banner img').complete")
    check(pg.evaluate("document.querySelector('.lab-banner img').naturalWidth") == 793 and pg.is_hidden(".lab-name"), "the lab banner shows in the header, from the repo")
    check(pg.inner_text("#checked").startswith("Calls last checked"), "the header says when the board was last checked for new calls")
    pg.wait_for_function("document.querySelector('.lab-logo').complete")
    check(pg.evaluate("document.querySelector('.lab-logo').naturalWidth") > 0 and pg.is_visible(".lab-logo"), "the lab logo shows next to the title")
    nob = new_ctx(banner=False)
    pb = open_page(nob, tag="no banner")
    loaded(pb)
    pb.wait_for_selector(".lab-name:not([hidden])")
    check(pb.is_hidden(".lab-banner img") and pb.inner_text(".lab-name") == "Space Physics at Princeton", "if the banner can't load, the lab's name shows instead")
    check(pg.get_attribute("#editBtn", "aria-pressed") == "false", "opens in view mode")
    check(pg.is_hidden("#addCallBtn"), "Add a call is hidden in view mode")
    check(pg.is_hidden("#changesBand") and pg.is_hidden("#noticeBand"), "no bands on a normal first visit")
    check(pg.locator("#lanes .opp").count() == len(SEED["opps"]), "all calls listed")
    pg.locator("#lanes .opp .opp-head").first.click()
    body = pg.locator("#lanes .opp.is-open .opp-body")
    check(body.locator(".stepper button").count() == 0, "no score buttons in view mode")
    check(body.locator(".stepper.readonly output").count() == 3, "scores shown read-only")
    check(body.locator(".actions:not(.share)").count() == 0, "no Edit, Rescore, Archive or Delete in view mode")
    check(body.locator(".actions.share").get_by_role("button", name="Copy link").count() == 1, "every open call offers Copy link")
    pg.click("#tab-capabilities")
    check(pg.locator("#capList input[type=checkbox]").count() == 0, "no Confirmed checkboxes in view mode")
    check(pg.locator("#capList .confirm-text").count() == len(SEED["caps"]), "each capability row shows whether it's confirmed")
    check(pg.is_hidden("#addCap") and pg.is_visible("#capIntroView"), "register is read-only with a hint on how to correct it")
    pg.click("#tab-opportunities")
    pg.click("#checkNowBtn")
    pg.wait_for_selector(".lane.review .rv")
    rv = pg.locator(".lane.review")
    check(rv.locator(".view-hint").count() == 1, "To review explains what to do in view mode")
    check(rv.get_by_role("button", name="Add to board").count() == 0 and rv.get_by_role("button", name="Mark reviewed").count() == 0, "no review actions in view mode")
    src = rv.locator(".src-status").inner_text()
    check(all(x in src for x in ("NASA's ROSES blog: read", "NASA on Grants.gov: read", "NSF on Grants.gov: read")), "all three sources read")
    lists = [u for u in nasa_log if "parent=" in u]
    check(bool(lists) and all("_fields=" in u and "modified_after=" in u for u in lists), "the NASA listing asks only for recent posts, without their bodies")
    bodies = [u for u in nasa_log if "include=" in u]
    check(len(bodies) == 1 and "1500001" in bodies[0] and "1500002" in bodies[0], "post bodies are fetched only for posts still to review")
    check(bool(rv.locator(".rv").filter(has_text="B.9 Heliophysics Example").locator("ul.rv-sent li").count()), "due-date lines still come through")
    check(bool(gg_log) and gg_log[0].startswith("text/plain"), "Grants.gov is asked with a simple request first")
    stored = json.loads(pg.evaluate(f"localStorage.getItem('{K_CHANGES}')") or "{}")
    check(not (stored.get("meta") or {}).get("checkedOn") and pg.is_hidden("#changesBand"), "checking for new calls in view mode leaves nothing to publish")
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
    pg.click("#cf-" + ROW_A)
    check(pg.is_checked("#cf-" + ROW_A) and "1 call, 1 capability row" in band(pg), "confirming a capability adds to the band")
    pg.click("#tab-opportunities")
    pg.locator(".lane.review .rv").filter(has_text="B.9 Heliophysics Example").get_by_role("button", name="Mark reviewed").click()
    check("1 NASA post reviewed" in band(pg), "a reviewed NASA post counts as a change")
    api["calls"] = 0
    pg.click("#publishBtn")
    pg.wait_for_selector("#publishPanel:not([hidden])")
    check(api["calls"] == 1 and api["accept"] == "application/vnd.github.raw+json", "publish reads the latest board through GitHub's API")
    summary = pg.inner_text("#publishSummary")
    check(f"{len(SEED['opps'])} calls and {len(SEED['caps'])} capability rows" in summary, "publish summary counts the board")
    check(pg.get_attribute("#editLink", "href") == EDIT_URL, "GitHub link opens board.json in the editor")
    check(pg.is_hidden("#publishBtn") and pg.is_visible("#publishSteps"), "the three publish steps replace the button")
    pg.click("#copyBoardBtn")
    pg.wait_for_function("document.querySelector('#copyMsg').textContent.length > 0")
    check("Copied" in pg.inner_text("#copyMsg"), "copy confirms")
    text = pg.evaluate("navigator.clipboard.readText()")
    data = json.loads(text)
    check(data["opps"]["next-hlcas"]["a"] == a1, "published board has the new score")
    check(data["caps"][ROW_A]["confirmed"] is True, "published board has the confirmed capability")
    check("wp:1500001" in data["nasa"]["reviewed"], "published board records the reviewed NASA post")
    check(data["checkedOn"] == SEED["checkedOn"] and data["checkNote"] == SEED["checkNote"], "a NASA check in view mode doesn't change the published note")
    check(check_board.canonical(data) == text, "published board.json is in the canonical layout")
    errs, _ = check_board.check(data)
    check(not errs, "published board.json passes tools/check_board.py" + ("" if not errs else ": " + "; ".join(errs)))
    same = [k for k in SEED["opps"] if k != "next-hlcas" and data["opps"][k] == SEED["opps"][k]]
    check(len(same) == len(SEED["opps"]) - 1, "untouched calls are byte-for-byte unchanged")
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
    pg.click("#cf-" + ROW_B)
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
    check(json.loads(pg.input_value("#publishText"))["caps"][ROW_B]["confirmed"] is True, "the selectable text is the new board")

    # 7. Discard.
    pg.click("#discardBtn")
    pg.click("#discardBtn")
    check(pg.is_hidden("#changesBand"), "Discard my changes clears the band")
    pg.click("#tab-capabilities")
    check(pg.is_checked("#cf-" + ROW_B) == bool(SEED["caps"][ROW_B]["confirmed"]), "discarded change is gone")

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

    # 8a. NSF listings from Grants.gov: the watch list, calls that accept proposals anytime, and adding one.
    before = board_text()
    detail_log.clear()
    ns = new_ctx()
    ns.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
    pn2 = ns.new_page()
    pn2.on("pageerror", lambda e: errors.append(f"nsf: {e}"))
    pn2.clock.set_fixed_time("2026-11-21T12:00:00")
    pn2.goto(BASE)
    loaded(pn2)
    check(pn2.is_hidden("#agencySeg"), "no funder filter while every call is NASA's")
    pn2.click("#checkNowBtn")
    pn2.wait_for_selector('.lane.review .rv[data-key="nsf:26-516"]')
    rvn = pn2.locator(".lane.review")
    keys = set(rvn.locator(".rv").evaluate_all("els => els.map(e => e.dataset.key)"))
    check({"nsf:26-516", "nsf:26-522", "nsf:27-500", "nsf:22-639", "nsf:22-586"} <= keys, "the NSF programs on the watch list wait under To review")
    swer = rvn.locator('.rv[data-key="nsf:26-599"]')
    check(swer.count() == 1 and swer.locator("xpath=ancestor::details").count() == 0, "a listing whose title names a lab topic is treated as watched")
    check(swer.locator("a.rv-title").get_attribute("href").startswith("https://www.grants.gov/"), "a link outside nsf.gov is ignored and the title opens Grants.gov")
    check("nsf:24-547" not in keys and "nsf:PD-98-1331" not in keys, "older NSF listings off the watch list stay out")
    other_nsf = rvn.locator("details.sub-lane", has_text="Other NSF listings")
    check(other_nsf.count() == 1 and other_nsf.locator('.rv[data-key="nsf:27-502"]').count() == 1, "a new NSF listing off the watch list folds under Other NSF listings")
    # text_content, since the group is folded and folded text isn't rendered.
    check(other_nsf.locator('.rv[data-key="nsf:27-502"] .rv-title').text_content() == "Example Biology Research & Training", "listing titles are decoded")
    check(sorted(detail_log) == sorted(["363684", "363620", "364243", "343875", "330001", "364400"]), "details are fetched only for watched listings")
    geo = rvn.locator('.rv[data-key="nsf:26-516"]')
    check(geo.locator(".abbr").inner_text() == "GEO Core" and geo.locator(".element").inner_text() == "NSF 26-516" and "Geosciences" in geo.locator(".opp-meta").inner_text(), "NSF cards show the program's short name, number and directorate")
    check("Proposals accepted anytime." in geo.inner_text() and "About $110M in all, for up to 350 awards." in geo.inner_text(), "GEO Core says it accepts proposals anytime, with its funding")
    check(geo.locator("a.rv-title").get_attribute("href") == "https://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf26516" and geo.locator("a.rv-also").get_attribute("href") == "https://www.grants.gov/search-results-detail/363684", "the title opens NSF's page and the Grants.gov listing is linked too")
    mri = rvn.locator('.rv[data-key="nsf:27-500"]')
    check("Grants.gov close date: Jan 29, 2027." in mri.inner_text() and "Awards of $100K to $4M." in mri.inner_text(), "MRI shows its close date and award range")
    pn2.click("#editBtn")
    geo.get_by_role("button", name="Add to board").click()
    check(pn2.input_value("#a-agency") == "NSF" and pn2.input_value("#a-division") == "Geosciences" and pn2.input_value("#a-element") == "NSF 26-516" and pn2.input_value("#a-sid") == "NSF 26-516", "Add to board fills in the funder, directorate and NSF number")
    check(pn2.input_value("#a-abbr") == "GEO Core" and pn2.input_value("#a-title") == "Geosciences Core Research: Atmospheric, Geospace, Earth and Ocean Sciences", "the short name comes off the end of the title")
    check(pn2.input_value("#a-due") == "" and pn2.input_value("#a-duelabel") == ANYTIME and pn2.input_value("#a-source").startswith("https://www.nsf.gov/"), "an anytime call gets no deadline, and links to NSF")
    pn2.locator("#addPanel").screenshot(path=str(OUT / "add-nsf.png"))
    pn2.click("#a-ai")
    prompt = pn2.input_value("#a-prompt")
    check("Funder: NSF" in prompt and "Intellectual Merit and Broader Impacts" in prompt and "none: proposals accepted anytime" in prompt and "or proposals are accepted anytime" in prompt, "the AI prompt says it's an NSF call that takes proposals anytime")
    pn2.select_option("#a-agency", "NASA")
    check(pn2.input_value("#a-division") == "Heliophysics", "changing the funder changes the divisions offered")
    pn2.select_option("#a-agency", "NSF")
    pn2.select_option("#a-division", "Geosciences")
    pn2.click("#a-save")
    pn2.wait_for_selector("form.opp-form")
    pn2.locator("form.opp-form").get_by_role("button", name="Save changes").click()
    geo_card = pn2.locator(".opp", has_text="Geosciences Core Research")
    check(geo_card.count() == 1 and geo_card.locator(".opp-meta").inner_text().startswith("NSF · Geosciences"), "the new call says it's NSF's")
    check(geo_card.locator(".when .tminus").inner_text() == "Anytime" and geo_card.locator(".when .date").inner_text() == "No deadline", "an anytime call shows Anytime instead of a countdown")
    check(geo_card.locator('output[aria-label="Timing"]').inner_text() == "2/2", "an anytime call gets Timing 2")
    check(rvn.locator('.rv[data-key="nsf:26-516"]').count() == 0, "the listing leaves To review once added")
    seg = pn2.locator("#agencySeg")
    check(seg.is_visible() and seg.locator("button").all_inner_texts() == ["All funders", "NASA", "NSF"], "a funder filter appears once the board has NSF calls")
    seg.get_by_role("button", name="NSF").click()
    check(pn2.locator("#lanes .opp").count() == 1, "NSF shows only NSF calls")
    geo_card.screenshot(path=str(OUT / "nsf-call-desktop.png"))
    rvn.screenshot(path=str(OUT / "nsf-review-desktop.png"))
    pn2.set_viewport_size({"width": 390, "height": 844})
    check(pn2.evaluate("document.documentElement.scrollWidth") <= 390, "no sideways scroll on a phone with NSF calls and the funder filter")
    pn2.screenshot(path=str(OUT / "nsf-phone.png"), full_page=False)
    pn2.set_viewport_size({"width": 1280, "height": 900})
    seg.get_by_role("button", name="All funders").click()
    check(pn2.locator("#lanes .opp").count() == len(SEED["opps"]) + 1, "All funders shows every call again")
    with pn2.expect_download() as dl:
        pn2.click("#exportIcs")
    ics_n = Path(dl.value.path()).read_bytes().decode("utf-8")
    due_after = [k for k, o in SEED["opps"].items() if o.get("status") != "archived" and o.get("due") and o["due"] >= "2026-11-21"]
    check(ics_n.count("BEGIN:VEVENT") == len(due_after) and "GEO Core" not in ics_n, "calls accepted anytime stay out of calendar files")
    with pn2.expect_download() as dl:
        pn2.click("#exportOpps")
    csv_rows = Path(dl.value.path()).read_text(encoding="utf-8-sig").splitlines()
    check(csv_rows[0].startswith("Short name,Funder,Element") and any(r.startswith("GEO Core,NSF,NSF 26-516,") for r in csv_rows), "the CSV export has a Funder column")
    rvn.locator('.rv[data-key="nsf:26-522"]').get_by_role("button", name="Mark reviewed").click()
    check("1 call" in band(pn2) and "2 listings reviewed" in band(pn2), "NSF listings added or marked reviewed count in the band")
    pn2.click("#publishBtn")
    pn2.wait_for_selector("#publishPanel:not([hidden])")
    pn2.click("#copyBoardBtn")
    pn2.wait_for_function("document.querySelector('#copyMsg').textContent.length > 0")
    text3 = pn2.evaluate("navigator.clipboard.readText()")
    d3 = json.loads(text3)
    added = [o for o in d3["opps"].values() if o.get("sid") == "NSF 26-516"]
    check(len(added) == 1 and added[0]["agency"] == "NSF" and added[0]["t"] == 2 and added[0]["due"] is None and list(added[0])[:3] == ["abbr", "agency", "element"],
          "the published NSF call keeps its funder, no deadline and Timing 2, in canonical order")
    check([s["label"] for s in added[0]["sources"]] == ["NSF solicitation", "Grants.gov listing"], "and links to both NSF and Grants.gov")
    check(set(d3["nsf"]["reviewed"]) == {"nsf:26-516", "nsf:26-522"} and d3["nsf"]["floor"] == "2026-11-20" and not any(k.startswith("nsf:") for k in d3["nasa"]["reviewed"]), "reviewed NSF listings are published under nsf")
    errs3, _ = check_board.check(d3)
    check(check_board.canonical(d3) == text3 and not errs3, "a board with an NSF call passes tools/check_board.py in canonical form" + ("" if not errs3 else ": " + "; ".join(errs3)))
    set_board(text3)
    after_ctx = new_ctx()
    pa = after_ctx.new_page()
    pa.on("pageerror", lambda e: errors.append(f"nsf after publish: {e}"))
    pa.clock.set_fixed_time("2026-11-21T12:00:00")
    pa.goto(BASE)
    loaded(pa)
    pa.click("#checkNowBtn")
    pa.wait_for_selector('.lane.review .rv[data-key="nsf:27-500"]')
    keys2 = set(pa.locator(".lane.review .rv").evaluate_all("els => els.map(e => e.dataset.key)"))
    check("nsf:26-516" not in keys2 and "nsf:26-522" not in keys2, "once published, an NSF call on the board and a reviewed listing don't come back")
    set_board(before)

    # 8a2. NSF's listings can't be read: NASA's still are, and the page says what was missed.
    gg_mode["nsf"] = "fail"
    down = new_ctx()
    pdn = open_page(down, tag="nsf down")
    loaded(pdn)
    pdn.click("#checkNowBtn")
    pdn.wait_for_selector(".lane.review .src-status .bad")
    s_down = pdn.locator(".lane.review .src-status").inner_text()
    check("NSF calls weren't checked" in s_down and "NASA on Grants.gov: read" in s_down and pdn.locator('.rv[data-key^="nsf:"]').count() == 0, "if NSF's listings can't be read, NASA's still are")
    check("Couldn't read NSF on Grants.gov" in pdn.inner_text("#toast"), "and the message says what was missed")
    gg_mode["nsf"] = "serve"

    # 8a3. A board published from a newer version of the page isn't overwritten from an older one.
    newer_app = json.loads(before)
    newer_app["app"] = "9.0.0"
    set_board(check_board.canonical(newer_app))
    gctx = new_ctx()
    pgd = open_page(gctx, tag="newer board")
    loaded(pgd)
    pgd.click("#editBtn")
    pgd.click("#tab-capabilities")
    pgd.click("#cf-" + ROW_B)
    pgd.click("#publishBtn")
    pgd.wait_for_function("document.querySelector('#toast').textContent.includes('newer version')")
    check(pgd.is_hidden("#publishPanel") and pgd.is_visible("#publishBtn"), "publishing over a board from a newer page asks for a reload instead")
    set_board(before)

    # 8a4. The checker knows the funders and the nsf block.
    bad = json.loads(SEED_TEXT)
    bad["opps"][next(iter(bad["opps"]))]["agency"] = "ESA"
    check(any('"agency"' in e for e in check_board.check(bad)[0]), "the checker rejects an unknown funder")
    bad2 = json.loads(SEED_TEXT)
    bad2["nsf"] = {"floor": "soon", "reviewed": {"nsf:26-516": 5}}
    check(len(check_board.check(bad2)[0]) == 2, "the checker checks the nsf block")

    # 8b. Links to a call, calendar files and the register's links.
    lk = new_ctx()
    lk.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
    pl2 = open_page(lk, BASE + "#call/r25-b8-ssf", tag="links")  # on FIXED_NOW, when every deadline is still ahead
    loaded(pl2)
    pl2.wait_for_selector("#opp-r25-b8-ssf.is-open")
    check(pl2.get_attribute("#opp-r25-b8-ssf .opp-head", "aria-expanded") == "true", "a link to a call opens that call")
    pl2.locator("#opp-r25-b8-ssf").get_by_role("button", name="Copy link").click()
    pl2.wait_for_function("navigator.clipboard.readText().then(t => t.length > 0)")
    check(pl2.evaluate("navigator.clipboard.readText()") == BASE + "#call/r25-b8-ssf", "Copy link copies the call's address")
    pl2.locator("#opp-r25-c2-sss .opp-head").click()
    check(pl2.evaluate("location.hash") == "#call/r25-c2-sss", "opening another call updates the address")
    with pl2.expect_download() as dl:
        pl2.click("#exportIcs")
    ics = Path(dl.value.path()).read_bytes().decode("utf-8")
    today = FIXED_NOW[:10]
    upcoming = [k for k, o in SEED["opps"].items() if o.get("status") != "archived" and o.get("due") and o["due"] >= today]
    lines = ics.split("\r\n")
    check(ics.startswith("BEGIN:VCALENDAR\r\n") and ics.count("BEGIN:VEVENT") == len(upcoming) and len(upcoming) > 0, f"the calendar file has one event per upcoming deadline ({len(upcoming)})")
    check(all(len(x.encode("utf-8")) <= 75 for x in lines) and "TRIGGER:-P7D" in ics and ("URL:" + BASE + "#call/") in ics.replace("\r\n ", ""), "calendar lines are folded, with reminders and links back to each call")
    with pl2.expect_download() as dl:
        pl2.locator("#opp-r25-c2-sss").get_by_role("button", name="Add to calendar").click()
    one = Path(dl.value.path()).read_bytes().decode("utf-8")
    check(one.count("BEGIN:VEVENT") == 1 and "SUMMARY:SSS due" in one.replace("\r\n ", ""), "a single call's deadline can be saved too")
    pl2.click("#tab-capabilities")
    check(pl2.locator("#cap-C1 dt", has_text="Contact").count() == 0 and pl2.locator("#cap-C15 dt", has_text="Contact").count() == 1, "contacts show only where they're set")
    first = pl2.locator("#cap-C1 .cap-used button").first
    target = first.inner_text()
    first.click()
    check(pl2.get_attribute("#tab-opportunities", "aria-selected") == "true" and pl2.locator(".opp.is-open .abbr", has_text=target).count() >= 1, "Used by links open the call")

    # 8c. Calls whose deadline has passed move out of Open now.
    later2 = new_ctx()
    pz = later2.new_page()
    pz.on("pageerror", lambda e: errors.append(f"passed: {e}"))
    pz.clock.set_fixed_time("2026-11-15T12:00:00")
    pz.goto(BASE)
    loaded(pz)
    gone = sorted(k for k, o in SEED["opps"].items() if o.get("status") in ("open", "step2") and o.get("due") and o["due"] < "2026-11-15")
    lane_txt = pz.locator("details.lane", has_text="Deadline passed")
    check(len(gone) > 0 and lane_txt.count() == 1 and lane_txt.locator(".opp").count() == len(gone), f"calls past their deadline sit under Deadline passed ({len(gone)})")
    open_sec = pz.locator("section.lane", has_text="Open now")
    check(all(open_sec.locator("#opp-" + k).count() == 0 for k in gone), "and leave Open now")

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
    check(bg == "rgb(20, 20, 20)", "dark theme follows the computer setting")
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
    pl.wait_for_function("document.querySelector('#checkNowBtn').textContent === 'Check for new calls'")
    pl.click("#tab-capabilities")
    pl.click("#cf-C4")
    pl.click("#publishBtn")
    pl.wait_for_selector("#publishPanel:not([hidden])")
    pl.click("#copyBoardBtn")
    pl.wait_for_function("document.querySelector('#copyMsg').textContent.length > 0")
    d2 = json.loads(pl.evaluate("navigator.clipboard.readText()"))
    check(d2["checkedOn"] == "2026-10-30" and d2["checkNote"] == "Last checked Oct 30, 2026 against NASA's ROSES blog and Grants.gov (NASA and NSF).", "a check in edit mode on a later day updates the published note")

    # 11. A downloaded copy loads the latest board from the site and says it's a copy.
    copydir = Path(tempfile.mkdtemp(prefix="pspl-copy-"))
    for name in ("index.html", "app.js", "style.css"):
        shutil.copy(work / name, copydir / name)
    fc = new_ctx()
    pf = open_page(fc, "file://" + quote(str(copydir / "index.html")), tag="file copy")
    loaded(pf)
    check(pf.is_visible("#noticeBand") and "downloaded copy" in pf.inner_text("#noticeText"), "a downloaded copy says so")
    check(pf.get_attribute("#noticeText a", "href") == SITE_URL, "and links to the shared board")
    check(pf.locator("#lanes .opp").count() == len(SEED["opps"]), "a downloaded copy still shows the live board")

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
