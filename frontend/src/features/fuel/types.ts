export interface AtzStatus {
  id: string;
  gosNumber: string;
  title: string | null;
  remainingLiters: number;
  isActive: boolean | null;
  openShift: {
    id: string;
    driver: {
      id: string;
      fullName: string;
    };
    startedAtClient: string;
  } | null;
}

export interface CreateAtzInput {
  gosNumber: string;
  title?: string;
  tisVehicleId?: string;
  remainingLiters?: number;
  isActive?: boolean;
}

export interface UpdateAtzInput {
  title?: string;
  tisVehicleId?: string;
  isActive?: boolean;
  remainingLiters?: number;
}

export interface Vehicle {
  id: string;
  gosNumber: string;
  mark: string | null;
  vehicleType: string | null;
  organizationName: string;
  source: string;
  isActive: boolean | null;
}

export interface Driver {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean | null;
  lastShiftAt: string | null;
}

export type ShiftFilters = {
  status?: 'open' | 'closed';
  from?: string;
  to?: string;
  limit?: number;
};

export interface ShiftSummary {
  id: string;
  driver: {
    id: string;
    fullName: string;
    login: string;
  };
  atz: {
    id: string;
    gosNumber: string;
  };
  startedAtClient: string;
  endedAtClient: string | null;
  status: 'open' | 'closed' | null;
  openingRemainingLiters: number;
  closingRemainingLiters: number | null;
  deviceId: string | null;
  dispenseCount: number;
  dispenseLiters: number;
  receiptLiters: number;
  editsCount: number;
}

export interface CloseShiftInput {
  closingRemainingLiters?: number;
  endedAtClient?: string;
}

export interface DispenseEvent {
  id: string;
  vehicle: {
    id: string;
    gosNumber: string;
    mark: string | null;
  };
  liters: number;
  recipientName: string;
  happenedAtClient: string;
  receivedAtServer: string | null;
  isDeleted: boolean;
  editedAt: string | null;
  wasEdited: boolean;
}

export interface ReceiptEvent {
  id: string;
  liters: number;
  happenedAtClient: string;
  receivedAtServer: string | null;
  isDeleted: boolean;
  editedAt: string | null;
  wasEdited: boolean;
  ttnPhotoStatus: 'pending' | 'uploaded';
  ttnPhotoPath: string | null;
}

export interface EventEdit {
  id: string;
  eventId: string;
  eventType: string;
  before: unknown;
  after: unknown;
  editedAt: string | null;
}

export interface ShiftDetail extends ShiftSummary {
  dispenses: DispenseEvent[];
  receipts: ReceiptEvent[];
  edits: EventEdit[];
}

export interface EditEventResult {
  id: string;
  type: 'dispense' | 'receipt';
  liters: number;
  isDeleted: boolean;
  editedAt: string;
  atz: {
    id: string;
    remainingLiters: number;
  };
}
