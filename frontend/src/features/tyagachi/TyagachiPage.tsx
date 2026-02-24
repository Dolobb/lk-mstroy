import React from 'react';
import { Routes, Route } from 'react-router-dom';
import TyagachiDashboard from './TyagachiDashboard';
import TyagachiReportView from './TyagachiReportView';

export const TyagachiPage: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col">
    <Routes>
      <Route index element={<TyagachiDashboard />} />
      <Route path="requests/:requestNumber" element={<TyagachiReportView />} />
    </Routes>
  </div>
);
