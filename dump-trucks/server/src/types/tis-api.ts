/** TIS Online v3 API response interfaces */

// === getRequests ===

export interface TisRequestRoutePoint {
  address: string;
  latLon?: { lat: number; lng: number };
  date?: string;
  time?: string;
  person?: string;
  addressdesc?: string;
  index?: number;
}

export interface TisRequestOrder {
  id: number;
  type?: string;
  typeOfWork?: string;
  nameCargo?: string;
  weightCargo?: number;
  volumeCargo?: number;
  countTs?: number;
  cntTrip?: number;
  route?: {
    polyline?: string;
    points?: TisRequestRoutePoint[];
    distance?: number;
    time?: number;
    timeZoneTag?: string;
  };
  objectExpend?: {
    code: string;
    name: string;
  };
  kindType?: string;
  notes?: string;
}

export interface TisRequest {
  id: number;
  number: number;
  status: string;
  dateCreate: string;       // DD.MM.YYYY HH:mm:ss
  dateProcessed: string;    // DD.MM.YYYY HH:mm:ss
  contactPerson: string;
  phonePerson?: string;
  idOwnCustomer?: number;
  responsiblePerson?: string;
  orders?: TisRequestOrder[];
}

// === getRouteListsByDateOut ===

export interface TisRouteListCalc {
  idOrder?: number;
  orderDescr: string;
  objectExpend: string;
  address?: string;
  driverTask: string;
}

export interface TisRouteListVehicle {
  idMO: number;
  regNumber: string;
  nameMO: string;
  category: string;
  garageNumber: string;
}

export interface TisRouteListDriver {
  id: number;
  tabelNumber?: string;
}

export interface TisRouteListFuelRate {
  typeFuelTank?: string;
  fOut?: number;
  fSpend?: number;
  fIn?: number;
  tankSize?: number;
  fuelRateName?: string;
  isSensorGlonass?: boolean;
}

export interface TisRouteList {
  id: number;
  tsNumber: number;
  tsType: string;
  dateOut: string;          // DD.MM.YYYY
  dateOutPlan: string;      // DD.MM.YYYY HH:mm:ss
  dateInPlan: string;       // DD.MM.YYYY HH:mm:ss
  startOdo?: number;
  finishOdo?: number;
  status: string;
  closeList?: string | null;
  ts: TisRouteListVehicle[];
  drivers?: TisRouteListDriver[];
  fuelRates?: TisRouteListFuelRate[];
  calcs: TisRouteListCalc[];
}

// === getMonitoringStats ===

export interface TisTrackPoint {
  lat: number;
  lon: number;
  direction?: number;
  time: string;             // DD.MM.YYYY HH:mm:ss
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
  begin: string;            // DD.MM.YYYY HH:mm:ss
  end: string;              // DD.MM.YYYY HH:mm:ss
  address?: string;
}

export interface TisMonitoringStats {
  moUid?: string;
  orgName?: string;
  nameMO?: string;
  distance?: number;
  movingTime?: number;        // seconds
  engineTime: number;         // seconds
  engineIdlingTime: number;   // seconds
  lastActivityTime?: string;
  ignitionWork?: boolean;
  equipmentTime?: number | null;
  movingRate?: number;
  track: TisTrackPoint[];
  parkings: TisParking[];
  fuels: TisFuel[];
}
