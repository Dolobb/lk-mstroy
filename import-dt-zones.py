"""
Import dt_* zones from fleetradar GeoJSON into geo.zones + geo.zone_tags.
Usage: python3 import-dt-zones.py path/to/export.geojson
"""
import json, sys, re, os
import psycopg2

GEOJSON_PATH = sys.argv[1] if len(sys.argv) > 1 else "export.geojson"

DB = dict(
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "5433")),
    dbname=os.getenv("DB_NAME", "mstroy"),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD", ""),
)

# Объекты в БД
OBJECT_MAP = {
    "тобольск": {"id": 285, "uid": "tobolsk-osnova",  "name": "Тобольск основа"},
    "екатеринбург": {"id": 286, "uid": "ekaterinburg", "name": "Екатеринбург"},
}

def detect_object(zone_name: str):
    name_lower = zone_name.lower()
    for keyword, obj in OBJECT_MAP.items():
        if keyword in name_lower:
            return obj
    return None

def detect_tag(zone_name: str):
    name_lower = zone_name.lower()
    if "погрузка" in name_lower:
        return "dt_loading"
    if "выгрузка" in name_lower:
        return "dt_unloading"
    if "граница" in name_lower or "boundary" in name_lower:
        return "dt_boundary"
    return None

def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-zа-яё0-9]+", "-", s)
    return s[:50].strip("-")

def main():
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        fc = json.load(f)

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()

    ok = 0
    skipped = 0

    for feat in fc["features"]:
        props = feat["properties"]
        zone_name = props.get("zoneName", "")
        geometry = feat["geometry"]

        obj = detect_object(zone_name)
        tag = detect_tag(zone_name)

        if not obj:
            print(f"  SKIP (no object match): {zone_name}")
            skipped += 1
            continue
        if not tag:
            print(f"  SKIP (no tag match): {zone_name}")
            skipped += 1
            continue

        uid = "dt-" + slugify(zone_name)
        geojson_str = json.dumps(geometry)

        # Upsert zone
        cur.execute("""
            INSERT INTO geo.zones (uid, object_id, name, geom)
            VALUES (
                %s, %s, %s,
                ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
            )
            ON CONFLICT (uid) DO UPDATE SET
                name = EXCLUDED.name,
                geom = EXCLUDED.geom,
                updated_at = now()
            RETURNING id
        """, (uid, obj["id"], zone_name, geojson_str))

        zone_id = cur.fetchone()[0]

        # Upsert tag
        cur.execute("""
            INSERT INTO geo.zone_tags (zone_id, tag)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
        """, (zone_id, tag))

        print(f"  OK [{obj['name']}] [{tag}]: {zone_name}")
        ok += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"\nДобавлено: {ok}, пропущено: {skipped}")

if __name__ == "__main__":
    main()
