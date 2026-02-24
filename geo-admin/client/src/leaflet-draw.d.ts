// Минимальные типы для Leaflet.draw (CDN версия)
import type * as L from 'leaflet';

declare module 'leaflet' {
  namespace Control {
    class Draw extends L.Control {
      constructor(options?: DrawConstructorOptions);
    }
    interface DrawConstructorOptions {
      position?: string;
      draw?: {
        polygon?: boolean | object;
        polyline?: boolean;
        rectangle?: boolean;
        circle?: boolean;
        marker?: boolean;
        circlemarker?: boolean;
      };
      edit?: {
        featureGroup: L.FeatureGroup;
        remove?: boolean;
      };
    }
  }
  namespace Draw {
    namespace Event {
      const CREATED: string;
    }
  }
}
