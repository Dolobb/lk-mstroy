import React from 'react';
import { TyagachiVehicleBlock } from './TyagachiVehicleBlock';
import { ReportsColumn } from '../../components/dashboard/reports-column';

const TyagachiDashboard: React.FC = () => {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 p-3 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Column 1 – Sync Panel + Vehicle Overview */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <TyagachiVehicleBlock />
        </div>

        {/* Column 2 – Reports */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <ReportsColumn
            vehicleType="tyagachi"
            onTypeChange={() => {}}
            onCreateReport={() => {}}
            hideTypeSlider
          />
        </div>
      </div>
    </div>
  );
};

export default TyagachiDashboard;
