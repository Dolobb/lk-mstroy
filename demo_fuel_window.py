# -*- coding: utf-8 -*-
"""Demo: sliding small getMonitoringStats windows to reconstruct a fuel-level curve.
idMO 37498 (0097081, AIRMAN), 20.05.2026 07:30->11:30, step 30 min."""
import json, os, subprocess, time, datetime as dt


def _read_token():
    """Токен НПС НЕ в репозитории — env NPS_TIS_TOKEN или gitignored _local/nps_token.txt."""
    t = os.environ.get("NPS_TIS_TOKEN")
    if t:
        return t.strip()
    if os.path.exists("_local/nps_token.txt"):
        return open("_local/nps_token.txt", encoding="utf-8").read().strip()
    raise SystemExit("Нет токена НПС: env NPS_TIS_TOKEN или _local/nps_token.txt")


TOKEN = _read_token(); BASE = "https://navi.nps-it.ru/api/v3"; IDMO = 37498
def call(frm,to):
    url=(f"{BASE}?token={TOKEN}&format=json&command=getMonitoringStats&idMO={IDMO}"
         f"&fromDate={frm.replace(' ','%20')}&toDate={to.replace(' ','%20')}")
    for _ in range(5):
        out=subprocess.run(["curl.exe","-s","-m","60","-X","POST","-d=","--noproxy","*","--url",url],capture_output=True).stdout.decode("utf-8","replace")
        j=json.loads(out)
        if isinstance(j,dict) and j.get("code")==429:
            time.sleep(31); continue
        return j
t=dt.datetime(2026,5,20,7,30); step=dt.timedelta(minutes=30)
print(f"{'window':<13}{'vBegin':>8}{'vEnd':>8}{'rate':>7}{'chg':>6}{'dis':>6}{'engT':>7}")
for i in range(8):
    a=t+step*i; b=a+step
    frm=a.strftime("%d.%m.%Y %H:%M"); to=b.strftime("%d.%m.%Y %H:%M")
    j=call(frm,to)
    f=(j.get("fuels") or [{}])
    f=f[0] if f else {}
    print(f"{a.strftime('%H:%M')}-{b.strftime('%H:%M'):<7}{f.get('valueBegin','-'):>8}{f.get('valueEnd','-'):>8}{f.get('rate','-'):>7}{f.get('charges','-'):>6}{f.get('discharges','-'):>6}{j.get('engineTime','-'):>7}")
    if i<7: time.sleep(31)
