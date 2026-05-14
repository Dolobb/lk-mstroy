/** TIS Online v3 API response interfaces */

export interface TisTrackPoint {
  lat: number;
  lon: number;
  direction?: number;
  time: string;
  speed?: number;
}

export interface TisFuel {
  unit?: string;
  charges?: number;
  discharges?: number;
  fuelName?: string;
  rate: number;
  valueBegin: number;
  valueEnd: number;
}

export interface TisParking {
  lat: number;
  lon: number;
  begin: string;
  end: string;
  address?: string;
}

export interface TisMonitoringStats {
  moUid?: string;
  orgName?: string;
  nameMO?: string;
  distance?: number;
  movingTime?: number;
  engineTime: number;
  engineIdlingTime: number;
  lastActivityTime?: string;
  ignitionWork?: boolean;
  equipmentTime?: number | null;
  movingRate?: number;
  track: TisTrackPoint[];
  parkings: TisParking[];
  fuels: TisFuel[];
}
