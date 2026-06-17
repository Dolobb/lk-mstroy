# BUG REPORT: gap-fill ne sozdayot zapisi dlya 7296OV72

Investigation date: 2026-04-15

---

## Ustanovlennye fakty (100%)

### 1. Gap-fill kod sushchestvuyet i korrekten
- gapFillJob.ts - 173 stroki, logika pravilnaya
- dailyFetchJob.ts - vyzyvaet fillGapsForDate(pool, gapDate) dlya [-10, 0] dney
- recalculateJob.ts - vyzyvaet fillGapsForDate(pool, date)
- Endpoint POST /api/admin/gap-fill?date= sushchestvuyet i otvechaet

### 2. Gap-fill RABOTAET dlya nekotorykh mashin
89 gap-filled zapisey v BD:
- 0457OK72, 0028OA72, 7718OE72, 7246OB72 - zapolnilis
- 7296OV72 - tolko 2 zapisi za 2026-04-09 (sozdany ranee)

### 3. 7296OV72 - boundary-dannye
Dlya lyuboy daty v diapazone [2026-03-31, 2026-04-07]:
- lastRecord (30 marta morning): latitude=NULL, longitude=NULL, fuel_value_end=0.00, fuel_value_begin=0.00
- nextRecord (8 aprelya evening): latitude=58.3006150, longitude=68.2201150, fuel_value_begin=NULL

### 4. Simulyatsiya logiki gapFillJob pokazyvaet onSite=true
- hasLastGps=false, hasNextGps=true -> gpsOk=true
- last.fuel_value_end=0.00 (ne null!), next.fuel_value_begin=null -> hasFuelData=false
- onSite=gpsOk=true -> DOLZHNO sozdavat zapis

### 5. KIP server NE rabotal na novom kode do peredapuska
- Staryy protsess rabotal s 15.04 9:16 na kode ot 13.04
- tsx watch NE peredapustilsya pri izmenenii faylov

### 6. Kriticheskiy bloker: geozoneAnalyzer padaet pri starte
Oshibka: stolbets z.min_duration_sec ne sushchestvuyet
- Opus dobavil min_duration_sec v SQL-zapros, no migratsiya ne primenena
- preloadZones() padaet -> cachedZones=[] -> vse operatsii s zonami ne rabotayut
- NO: gap-fill NE zavisit ot geozon

### 7. gap-fill endpoint vozvrashchaet started, no zapisi ne sozdayutsya
Dazhe posle peredapuska servera - gap-fill dlya 7296OV72 ne sozdayot zapisi

---

## Gde zatrudnenie

### Glavnaya zagadka: POWEMU gap-fill ne sozdayot zapisi dlya 7296OV72?

Simulyatsiya pokazyvaet onSite=true, no rezultat: 0 zapisey.

Veroyatnye prichiny:

1. gap-fill padaet molcha - catch proglatyvaet oshibku, ne vidno logov
2. Nesovpadenie vehicle_id - kirillitsa v regNumber mozhet vesti sebya neozhidanno
3. Kod ne tot - tsx watch keshiruet, logi ne pokazali [GapFill-DEBUG]
4. Oshibka min_duration_sec mozhet narushit initsializatsiyu

---

## Chto nuzhno sdelat dlya resheniya

1. Primenit migratsiyu geo.zones (dobavit min_duration_sec) ili ubrat iz SQL-zaprosa
2. Peredapustit KIP server
3. Dobavit sinhronnyy gap-fill endpoint:
   app.post('/api/admin/gap-fill-sync', ...) - vernut result napryamuyu
4. Proverit logi servera - zapustit s vidimym stdout
5. Proverit sovpadenie vehicle_id iz registry s BD