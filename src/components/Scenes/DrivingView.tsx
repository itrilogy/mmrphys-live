import React from 'react';
import { VitalSigns } from '@/types';
import { VitalSignsChart } from '@/components';
import { ShieldCheck, Eye, AlertCircle, Gauge } from 'lucide-react';

interface DrivingViewProps {
    vitalSigns: VitalSigns;
    avgHeartRate: number;
    avgRespRate: number;
    isReady: boolean;
}

const DrivingView: React.FC<DrivingViewProps> = ({
    vitalSigns,
    avgHeartRate,
    avgRespRate,
    isReady
}) => {
    // Simulated fatigue calculation
    const fatigueRisk = Math.min(100, (vitalSigns.heartRate < 65 ? 30 : 0) + (vitalSigns.respRate < 12 ? 40 : 10));
    const isHighRisk = fatigueRisk > 60;

    return (
        <div className="driving-view-container space-y-12 mb-8 animate-fade-in">
            {/* Driving Telemetry Hub */}
            {/* Driving Telemetry Hub - Dual Core Intelligence */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 items-stretch">
                {/* Safety Assessment Gauge */}
                <div className="xl:col-span-4 bg-white rounded-[3.5rem] p-10 shadow-[0_20px_60px_rgba(0,0,0,0.03)] border border-slate-200 flex flex-col items-center justify-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-slate-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                    {/* Circular Progress Design */}
                    <div className="relative w-64 h-64 mb-10 z-10">
                        <svg className="w-full h-full transform -rotate-90 drop-shadow-2xl">
                            <circle
                                cx="128"
                                cy="128"
                                r="110"
                                stroke="currentColor"
                                strokeWidth="16"
                                fill="transparent"
                                className="text-slate-100"
                            />
                            <circle
                                cx="128"
                                cy="128"
                                r="110"
                                stroke="currentColor"
                                strokeWidth="16"
                                strokeDasharray={2 * Math.PI * 110}
                                strokeDashoffset={2 * Math.PI * 110 * (1 - (isReady ? fatigueRisk / 100 : 0))}
                                strokeLinecap="round"
                                fill="transparent"
                                className={`transition-all duration-1000 ease-out ${isHighRisk ? 'text-rose-500' : 'text-emerald-500'}`}
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">疲劳风险</span>
                            <span className={`text-6xl font-black italic tracking-tighter tabular-nums ${isHighRisk ? 'text-rose-600' : 'text-slate-950'}`}>
                                {isReady ? Math.round(fatigueRisk) : '--'}
                            </span>
                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-1">评估协议指数</span>
                        </div>
                    </div>

                    <div className="w-full space-y-4 relative z-10 text-center">
                        <div className={`inline-flex items-center gap-2 px-6 py-2 rounded-2xl border ${isHighRisk ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-emerald-50 border-emerald-100 text-emerald-600'}`}>
                            {isHighRisk ? <AlertCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                            <span className="text-xs font-black uppercase italic tracking-widest">
                                {isHighRisk ? '关键预警' : '安全区域'}
                            </span>
                        </div>
                        <p className="text-[11px] text-slate-400 italic font-medium">驾驶舱疲劳评估：基于面部血流灌注稳定性</p>
                    </div>
                </div>

                {/* AU Radar Chart Context */}
                <div className="xl:col-span-8 bg-white rounded-[3.5rem] p-10 shadow-[0_20px_60px_rgba(0,0,0,0.03)] border border-slate-200 relative overflow-hidden group">
                    <div className="flex justify-between items-center mb-10 relative z-10">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-amber-50 rounded-2xl border border-amber-100">
                                <Eye className="w-6 h-6 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-slate-950 italic tracking-tight uppercase">面部特征语境</h3>
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest italic">动作单元 (AU) 实时解算</p>
                            </div>
                        </div>
                        <div className="text-xs font-black text-slate-300 uppercase tracking-widest border border-slate-100 px-5 py-2 rounded-xl bg-slate-50 italic">
                            高精度追踪开启
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 relative z-10">
                        {['AU01', 'AU04', 'AU06', 'AU12', 'AU25', 'AU45', 'Blink', 'Gaze'].map((au) => (
                            <div key={au} className="p-6 bg-slate-50 rounded-[2.5rem] border border-slate-100 flex flex-col items-center transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">{au}</span>
                                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3 shadow-inner">
                                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${30 + Math.random() * 50}%` }}></div>
                                </div>
                                <span className="text-xs font-black text-slate-900 italic tracking-tight uppercase">锁定中</span>
                            </div>
                        ))}
                    </div>

                    {/* Background Grid Pattern Overlay */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_rgba(0,0,0,0.01)_1px,_transparent_0)] bg-[size:40px_40px] pointer-events-none opacity-40"></div>
                </div>
            </div>

            {/* BVP Monitor for Driving (Full Width) */}
            <div className="bg-white p-12 rounded-[4rem] shadow-[0_20px_80px_rgba(0,0,0,0.03)] border border-slate-200 overflow-hidden relative group">
                <div className="flex justify-between items-center mb-10 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 shadow-xl shadow-slate-950/20">
                            <Gauge className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-slate-950 uppercase italic tracking-tight leading-none">实时安全监控</h3>
                            <span className="text-xs font-black text-slate-400 uppercase tracking-[0.1em] mt-2 block">BVP 信号收敛度分析</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-xs font-black text-slate-900 italic tracking-widest uppercase">采样版本 v3.2</span>
                        </div>
                    </div>
                </div>
                <div className="h-80 relative z-10">
                    <VitalSignsChart
                        title=""
                        data={vitalSigns.bvpSignal}
                        filteredData={vitalSigns.filteredBvpSignal}
                        rate={vitalSigns.heartRate}
                        snr={vitalSigns.bvpSNR}
                        quality={vitalSigns.bvpQuality}
                        type="bvp"
                        isReady={isReady}
                        avgRate={avgHeartRate}
                    />
                </div>
                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.01)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-30"></div>
            </div>
        </div>
    );
};

export default DrivingView;
