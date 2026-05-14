CREATE TABLE dump_trucks.dt_tracks (
    id serial PRIMARY KEY,
    shift_record_id int REFERENCES dump_trucks.shift_records(id) ON DELETE SET NULL,
    vehicle_id varchar NOT NULL,
    date date NOT NULL,
    track_simplified jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE (vehicle_id, date)
);
CREATE INDEX ON dump_trucks.dt_tracks (vehicle_id, date);
