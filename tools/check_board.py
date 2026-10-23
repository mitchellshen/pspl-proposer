#!/usr/bin/env python3
"""Check board.json before it goes live.

    python3 tools/check_board.py            # check board.json; exit 1 on errors
    python3 tools/check_board.py --format   # also rewrite it in the app's canonical form

Errors stop the site from deploying (see .github/workflows/pages.yml). Warnings are printed
but don't block. Only the Python standard library is used.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPP_FIELDS = ["abbr", "element", "title", "division", "sid", "status", "prevStatus", "statusNote", "due", "dueLabel", "a", "r", "t", "brings", "bringsText", "gaps", "says", "action", "notes", "sources", "flag", "origin", "createdAt", "updatedAt"]
CAP_FIELDS = ["kind", "category", "name", "evidence", "maturity", "source", "owner", "confirmed", "order", "updatedAt"]
STATUSES = {"open", "step2", "expected", "unknown", "archived"}
URL = re.compile(r"^https?://\S+$", re.I)
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$")


def canon(doc, fields):
    out = {f: doc[f] for f in fields if f in doc}
    for k in sorted(doc):
        if k not in out and k != "_deleted":
            out[k] = doc[k]
    return out


def cap_key(cid):
    m = re.fullmatch(r"([CG])(\d+)", cid)
    return ((0 if m.group(1) == "C" else 10000) + int(m.group(2))) if m else 20000


def canonical(data):
    out = dict(data)
    nasa = dict(data.get("nasa") or {})
    if isinstance(nasa.get("reviewed"), dict):
        nasa["reviewed"] = dict(sorted(nasa["reviewed"].items()))
    if isinstance(nasa.get("blogs"), list):
        nasa["blogs"] = sorted(nasa["blogs"], key=lambda b: b.get("id", 0) if isinstance(b, dict) else 0)
    out["nasa"] = nasa
    out["opps"] = {k: canon(v, OPP_FIELDS) for k, v in sorted(data["opps"].items())}
    out["caps"] = {k: canon(v, CAP_FIELDS) for k, v in sorted(data["caps"].items(), key=lambda kv: (cap_key(kv[0]), kv[0]))}
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"


def check(data):
    errors, warnings = [], []
    err = errors.append
    warn = warnings.append

    if not isinstance(data, dict):
        return ["The file must hold one JSON object."], []
    if data.get("format") != "pspl-proposer/1":
        err('"format" must be "pspl-proposer/1".')
    for key in ("opps", "caps"):
        if not isinstance(data.get(key), dict):
            err(f'"{key}" must be an object keyed by id.')
    if errors:
        return errors, warnings
    if not isinstance(data.get("savedAt"), str) or not STAMP.match(data["savedAt"]):
        warn('"savedAt" should be a timestamp such as 2026-10-23T18:00:00.000Z.')
    nasa = data.get("nasa")
    if nasa is not None and not isinstance(nasa, dict):
        err('"nasa" must be an object.')
    elif nasa:
        if not isinstance(nasa.get("reviewed", {}), dict) or not all(isinstance(v, str) for v in nasa.get("reviewed", {}).values()):
            err('"nasa.reviewed" must map post keys to timestamps.')
        if not isinstance(nasa.get("blogs", []), list) or not all(isinstance(b, dict) and isinstance(b.get("id"), int) for b in nasa.get("blogs", [])):
            err('"nasa.blogs" must be a list of {"id": number, "label": text}.')
    for key in ("site", "repo"):
        if key in data and not (isinstance(data[key], str) and URL.match(data[key])):
            err(f'"{key}" must be a web address.')

    caps = data["caps"]
    for cid, c in caps.items():
        where = f"caps/{cid}"
        if not re.fullmatch(r"[CG]\d{1,3}", cid):
            err(f"{where}: ids are C or G followed by a number, such as C14 or G5.")
        if not isinstance(c, dict):
            err(f"{where}: must be an object.")
            continue
        if c.get("kind") not in ("cap", "gap"):
            err(f'{where}: "kind" must be "cap" or "gap".')
        elif (c["kind"] == "gap") != cid.startswith("G"):
            warn(f"{where}: gaps usually have G ids and capabilities C ids.")
        if not (isinstance(c.get("name"), str) and c["name"].strip()):
            err(f'{where}: "name" is required.')
        if not isinstance(c.get("confirmed", False), bool):
            err(f'{where}: "confirmed" must be true or false.')
        src = c.get("source")
        if src is not None:
            if not isinstance(src, dict) or not isinstance(src.get("label", ""), str):
                err(f'{where}: "source" must be {{"label": text, "url": address}} or null.')
            elif "url" in src and not (isinstance(src["url"], str) and URL.match(src["url"])):
                err(f'{where}: "source.url" must start with http:// or https://.')
        for f, v in c.items():
            if isinstance(v, str) and len(v) > 4000:
                warn(f"{where}.{f}: unusually long ({len(v)} characters).")

    for oid, o in data["opps"].items():
        where = f"opps/{oid}"
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", oid):
            err(f"{where}: ids use lowercase letters, digits and hyphens.")
        if not isinstance(o, dict):
            err(f"{where}: must be an object.")
            continue
        if not (isinstance(o.get("title"), str) and o["title"].strip()):
            err(f'{where}: "title" is required.')
        if o.get("status") not in STATUSES:
            err(f'{where}: "status" must be one of {", ".join(sorted(STATUSES))}.')
        for f, top in (("a", 3), ("r", 3), ("t", 2)):
            v = o.get(f)
            if not (isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= top):
                err(f'{where}: "{f}" must be a whole number from 0 to {top}.')
        due = o.get("due")
        if due is not None:
            try:
                if not (isinstance(due, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", due)):
                    raise ValueError
                date.fromisoformat(due)
            except ValueError:
                err(f'{where}: "due" must be a date such as 2026-11-20, or null.')
        brings = o.get("brings", [])
        if not isinstance(brings, list) or not all(isinstance(x, str) for x in brings):
            err(f'{where}: "brings" must be a list of capability ids.')
        else:
            for x in brings:
                if x not in caps:
                    warn(f'{where}: "brings" lists {x}, which isn\'t in the register.')
                elif caps[x].get("kind") == "gap":
                    warn(f'{where}: "brings" lists {x}, which is a known gap.')
        sources = o.get("sources", [])
        if not isinstance(sources, list):
            err(f'{where}: "sources" must be a list.')
        else:
            for s in sources:
                if not (isinstance(s, dict) and isinstance(s.get("url"), str) and URL.match(s["url"])):
                    err(f'{where}: each source needs a "url" starting with http:// or https://.')
        if "updatedAt" in o and not (isinstance(o["updatedAt"], str) and STAMP.match(o["updatedAt"])):
            warn(f'{where}: "updatedAt" should be a timestamp.')
        for f, v in o.items():
            if isinstance(v, str) and len(v) > 4000:
                warn(f"{where}.{f}: unusually long ({len(v)} characters).")
    return errors, warnings


def main(argv):
    fix = "--format" in argv
    paths = [a for a in argv if not a.startswith("--")]
    path = Path(paths[0]) if paths else ROOT / "board.json"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        print(f"error: can't read {path}: {e}")
        return 1
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        print(f"error: {path.name} isn't valid JSON: {e.msg} at line {e.lineno}, column {e.colno}.")
        print("       A missing or extra comma or quote is the usual cause.")
        return 1
    errors, warnings = check(data)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("error:", e)
    if errors:
        print(f"{path.name}: {len(errors)} error(s); fix them before publishing.")
        return 1
    want = canonical(data)
    if text != want:
        if fix:
            path.write_text(want, encoding="utf-8", newline="\n")
            print(f"{path.name}: rewritten in canonical form.")
        else:
            print(f"note: {path.name} isn't in the app's canonical layout. That's fine; run with --format to tidy it.")
    print(f"{path.name}: OK ({len(data['opps'])} calls, {len(data['caps'])} capability rows, {len(warnings)} warning(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
