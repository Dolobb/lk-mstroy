ALTER TABLE geo.objects ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg';

UPDATE geo.objects SET timezone = 'Asia/Irkutsk'
WHERE name ILIKE '%бодайбо%'
   OR name ILIKE '%таксимо%бодайбо%';
