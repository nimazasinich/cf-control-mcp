import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { OperationalAlert, SystemReadiness } from '../types';

interface AppShellProps {
  children: React.ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  readiness?: SystemReadiness | null;
  alerts?: OperationalAlert[];
  observedRequests?: number;
}

export const AppShell: React.FC<AppShellProps> = ({ 
  children, 
  onRefresh, 
  isRefreshing,
  readiness,
  alerts,
  observedRequests
}) => {
  return (
    <div className="w-full h-screen flex flex-row bg-[#F8F7F4] text-slate-900 font-sans antialiased overflow-hidden select-none">
      <Sidebar readiness={readiness} observedRequests={observedRequests} />

      <div className="flex-1 h-full min-w-0 flex flex-col p-3 sm:p-3.5 gap-2.5 sm:gap-3 overflow-hidden">
        <Header onRefresh={onRefresh} isRefreshing={isRefreshing} readiness={readiness} alerts={alerts} />

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
};
