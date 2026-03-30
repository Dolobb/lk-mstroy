export interface ColumnDef {
  id: string;
  label: string;
  group: string;
  defaultIncluded: boolean;
  fixed?: boolean;
  width?: number;
}

export type ReportType = 'kip' | 'dump-truck-trips';

export interface ReportMeta {
  reportTypes: { id: ReportType; label: string }[];
  columns: ColumnDef[];
  filters: {
    objects?: { uid: string; name: string }[];
    departments?: string[];
    vehicles?: { id: string; label: string }[];
  };
}

export interface ReportFilters {
  objectUid?: string;
  departments?: string[];
  vehicles?: string[];
  shiftType?: string;
}
