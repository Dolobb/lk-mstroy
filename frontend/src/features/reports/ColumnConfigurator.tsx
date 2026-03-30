import React from 'react';
import { Plus, X } from 'lucide-react';
import type { ColumnDef } from './types';

interface Props {
  allColumns: ColumnDef[];
  included: string[];
  onChange: (newIncluded: string[]) => void;
}

export const ColumnConfigurator: React.FC<Props> = ({ allColumns, included, onChange }) => {
  const includedSet = new Set(included);

  const includedCols = allColumns.filter(c => includedSet.has(c.id));
  const availableCols = allColumns.filter(c => !includedSet.has(c.id));

  // Group available by group
  const availableGroups = new Map<string, ColumnDef[]>();
  for (const col of availableCols) {
    if (!availableGroups.has(col.group)) availableGroups.set(col.group, []);
    availableGroups.get(col.group)!.push(col);
  }

  const addColumn = (id: string) => onChange([...included, id]);
  const removeColumn = (id: string) => onChange(included.filter(x => x !== id));

  return (
    <div className="grid grid-cols-2 gap-3 h-full min-h-0">
      {/* Included */}
      <div className="flex flex-col min-h-0">
        <div className="text-xs font-medium text-foreground mb-2">
          Включены ({includedCols.length})
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {includedCols.map(col => (
            <div
              key={col.id}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card-inner/50 border border-border/50 group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-foreground truncate">{col.label}</span>
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
                  {col.group}
                </span>
              </div>
              {!col.fixed && (
                <button
                  onClick={() => removeColumn(col.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-0.5 cursor-pointer bg-transparent border-none"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Available */}
      <div className="flex flex-col min-h-0">
        <div className="text-xs font-medium text-foreground mb-2">
          Доступны ({availableCols.length})
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
          {availableCols.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">
              Все столбцы включены
            </div>
          )}
          {[...availableGroups.entries()].map(([group, cols]) => (
            <div key={group}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 px-1">
                {group}
              </div>
              <div className="space-y-1">
                {cols.map(col => (
                  <div
                    key={col.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-card-inner/50 border border-transparent hover:border-border/50 transition-all group"
                  >
                    <span className="text-xs text-muted-foreground group-hover:text-foreground truncate">
                      {col.label}
                    </span>
                    <button
                      onClick={() => addColumn(col.id)}
                      className="text-muted-foreground hover:text-primary transition-colors p-0.5 cursor-pointer bg-transparent border-none"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
