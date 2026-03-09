import React from 'react';
import MetricCard from './MetricCard';
import { VitalSigns } from '@/types';

interface DashboardLayoutProps {
    children: React.ReactNode;
    vitalSigns: VitalSigns;
    avgHeartRate: number;
    avgRespRate: number;
    isReady: boolean;
    bufferProgress: number;
    sceneName: string;
    sceneIcon: string;
    hideResp?: boolean;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({
    children,
    vitalSigns,
    avgHeartRate,
    avgRespRate,
    isReady,
    bufferProgress,
    hideResp = false
}) => {
    return (
        <div className="dashboard-layout space-y-16 animate-fade-in pb-24">
            {/* Main Content Area */}
            <main className="scene-content relative z-10 px-2 min-h-[400px]">
                {children}
            </main>
        </div>
    );
};

export default DashboardLayout;
