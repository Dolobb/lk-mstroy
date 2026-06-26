# -*- coding: utf-8 -*-
"""Resumable fetch of getMonitoringStats from external NPS TIS for 9 DiM vehicles.
Period 20.05.2026-20.06.2026, shifts 07:30-19:30 / 19:30-07:30 (Moscow local).
Saves raw JSON per (vehicle, day, shift) to comparison-cache/. Resume-safe.
Respects 1 request / 31s per (token, idMO).
"""
import json, os, sys, time, subprocess, datetime as dt

BASE = "https://navi.nps-it.ru/api/v3"


def _read_token():
    """Токен НПС НЕ хранится в репозитории. Берём из env или из gitignored-файла."""
    t = os.environ.get("NPS_TIS_TOKEN")
    if t:
        return t.strip()
    p = "_local/nps_token.txt"
    if os.path.exists(p):
        return open(p, encoding="utf-8").read().strip()
    raise SystemExit("Нет токена НПС: задайте env NPS_TIS_TOKEN или создайте _local/nps_token.txt")


TOKEN = _read_token()
CACHE = "_local/comparison-cache"
MIN_GAP = 31.0  # seconds per idMO

# 9 vehicles: (regNumber, idMO, podrazdelenie, model)
VEHICLES = [
    ("0097081",   37498, "МО-10",  "AIRMAN PDS390SC-W"),
    ("5578",      33251, "МО-90",  "BOREY 55-7F"),
    ("О415МУ977", 20273, "АТС",    "FAW J6 Автосамосвал"),
    ("20015034",  40203, "МО-6",   "JVM G140QW Дизельная электростанция"),
    ("В204РВ790", 20824, "МО-90",  "XCMG XCT30S1 Автокран"),
    ("1042МХ77",  39612, "МО-114", "SANY SCC1000A5 Кран гусеничный"),
    ("3764МР77",  20259, "МО-4",   "XCMG XE210WD Экскаватор колесный"),
    ("9979МО77",  23816, "МО-114", "SANY SCC550A Кран гусеничный"),
    ("7296НА50",  33224, "МО-90",  "XCMG XE210WD Экскаватор колесный"),
]

START = dt.date(2026, 5, 20)
END = dt.date(2026, 6, 20)  # inclusive


def windows():
    d = START
    while d <= END:
        ds = d.strftime("%Y-%m-%d")
        yield ds, "morning", d.strftime("%d.%m.%Y") + " 07:30", d.strftime("%d.%m.%Y") + " 19:30"
        nxt = d + dt.timedelta(days=1)
        yield ds, "evening", d.strftime("%d.%m.%Y") + " 19:30", nxt.strftime("%d.%m.%Y") + " 07:30"
        d = nxt


def cache_path(reg, day, shift):
    return os.path.join(CACHE, reg, f"{day}_{shift}.json")


def fetch_one(idmo, frm, to):
    url = (f"{BASE}?token={TOKEN}&format=json&command=getMonitoringStats"
           f"&idMO={idmo}&fromDate={frm.replace(' ', '%20')}&toDate={to.replace(' ', '%20')}")
    p = subprocess.run(
        ["curl.exe", "-s", "-m", "90", "-X", "POST", "-d=", "--noproxy", "*", "--url", url],
        capture_output=True)
    return p.stdout.decode("utf-8", "replace")


def main():
    last_req = {}  # idMO -> monotonic ts
    total = sum(1 for _ in windows()) * len(VEHICLES)
    done = 0
    fetched = 0
    log = open("_local/fetch_nps.log", "a", encoding="utf-8")

    def say(m):
        line = f"[{dt.datetime.now():%H:%M:%S}] {m}"
        print(line, flush=True)
        log.write(line + "\n"); log.flush()

    say(f"START total={total} windows")
    for day, shift, frm, to in windows():
        for reg, idmo, _pod, _mod in VEHICLES:
            done += 1
            cp = cache_path(reg, day, shift)
            os.makedirs(os.path.dirname(cp), exist_ok=True)
            if os.path.exists(cp) and os.path.getsize(cp) > 0:
                # validate it's not a stored error
                try:
                    j = json.load(open(cp, encoding="utf-8"))
                    if not (isinstance(j, dict) and j.get("code") in (429, 404, 500)):
                        continue
                except Exception:
                    pass
            # rate-limit gate per idMO
            for attempt in range(6):
                wait = MIN_GAP - (time.monotonic() - last_req.get(idmo, -1e9))
                if wait > 0:
                    time.sleep(wait)
                body = fetch_one(idmo, frm, to)
                last_req[idmo] = time.monotonic()
                try:
                    j = json.loads(body)
                except Exception:
                    j = None
                if isinstance(j, dict) and j.get("code") == 429:
                    say(f"429 {reg} {day} {shift} -> retry in {MIN_GAP}s")
                    continue
                if j is None:
                    say(f"BAD-JSON {reg} {day} {shift} len={len(body)} -> retry")
                    time.sleep(MIN_GAP)
                    continue
                open(cp, "w", encoding="utf-8").write(body)
                fetched += 1
                break
            if fetched % 25 == 0 and fetched:
                say(f"progress {done}/{total} fetched={fetched}")
    say(f"DONE done={done} newly_fetched={fetched}")
    log.close()


if __name__ == "__main__":
    main()
