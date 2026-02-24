import React, { useEffect, useState } from 'react';
import { GeoJSON, Tooltip } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import type { Layer, PathOptions } from 'leaflet';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const GEOZONE_STYLE: PathOptions = {
  fillColor: '#ffa726',
  fillOpacity: 0.08,
  color: '#ef6c00',
  weight: 1.5,
  dashArray: '6 4',
};

const GeozoneLayer: React.FC = () => {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/geozones`)
      .then(r => r.json())
      .then(data => setGeojson(data))
      .catch(() => {});
  }, []);

  if (!geojson) return null;

  return (
    <GeoJSON
      key={geojson.features.length}
      data={geojson}
      style={() => GEOZONE_STYLE}
      onEachFeature={(feature, layer: Layer) => {
        const name = feature.properties?.zoneName;
        if (name) {
          layer.bindTooltip(name, { sticky: true });
        }
      }}
    />
  );
};

export default GeozoneLayer;
