// src/App.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { VideoDisplay, Controls, VitalSignsChart } from '@/components';
import ReportView from '@/components/Report/ReportView';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities';
import { useVitalSigns } from '@/hooks/useVitalSigns';
import { VideoProcessor } from '@/utils/videoProcessor';
import {
    StatusMessage as StatusMessageType,
    VitalSigns as VitalSignsType,
    InferenceResult as InferenceResultType,
    ExportData as ExportDataType,
    SceneConfig,
    SceneType
} from '@/types';
import { SceneSelector } from '@/components';
import MainDashboard from '@/components/Dashboard/MainDashboard';
import GlobalMetricsRow from '@/components/Dashboard/GlobalMetricsRow';
import { Activity, Zap, Layers } from 'lucide-react';
import AboutModal from '@/components/AboutModal/AboutModal';

const SCENES: SceneConfig[] = [
    {
        id: 'lite',
        name: '基础快速检测',
        description: '基于 TS-CAN 极轻量化架构，快速响应，适合所有设备基础性能预览。',
        modelPath: '/models/tscan/model.onnx',
        configPath: '/models/tscan/config.json',
        shortModelName: 'TS-CAN',
        features: ['心率数值', '低延迟响应'],
        icon: '⚡',
        recommendedFPS: 30,
        chunkLength: 20
    },
    {
        id: 'balanced',
        name: '标准健康监测',
        description: '基于 SCAMPS MMRPhys 主力模型，临床级精度对齐，支持 BVP 与呼吸双任务监测。',
        modelPath: '/models/rphys/SCAMPS_Multi_72x72.onnx',
        configPath: '/models/rphys/config.json',
        shortModelName: 'SCAMPS',
        features: ['心率', '呼吸率', '高稳波形'],
        icon: '⚖️',
        recommendedFPS: 30,
        chunkLength: 181
    },
    {
        id: 'pro',
        name: '驾驶/疲劳监测',
        description: '多任务 BigSmall 卷积架构，同步实时分析生理指标与 12 类面部关键动作单元。',
        modelPath: '/models/bigsmall/model.onnx',
        configPath: '/models/bigsmall/config.json',
        shortModelName: 'BigSmall',
        features: ['心率', '面部 AUs', '疲劳/焦虑预警'],
        icon: '🚗',
        recommendedFPS: 30,
        chunkLength: 3
    },
    {
        id: 'expert',
        name: '科研高精分析',
        description: '基于 PhysFormer Transformer 架构，捕捉亚像素级微色差，深度解算 HRV 数据。',
        modelPath: '/models/physformer/model.onnx',
        configPath: '/models/physformer/config.json',
        shortModelName: 'PhysFormer',
        features: ['极致 BVP', 'HRV 深度指标', '散点图分析'],
        icon: '🧬',
        recommendedFPS: 30,
        chunkLength: 160
    }
];

const App: React.FC = () => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [bufferProgress, setBufferProgress] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<StatusMessageType>({
        message: '正在初始化系统...',
        type: 'info'
    });
    const [reportData, setReportData] = useState<ExportDataType | null>(null);
    const [selectedScene, setSelectedScene] = useState<SceneConfig>(SCENES[0]);
    const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

    const { capabilities, isChecking } = useDeviceCapabilities();
    const frameCollectionRef = useRef<{
        frames: ImageData[];
        initialCollectionComplete: boolean;
        framesSinceLastInference: number;
    }>({
        frames: [],
        initialCollectionComplete: false,
        framesSinceLastInference: 0
    });

    const cumulativeMetricsRef = useRef({
        heartRateSum: 0,
        heartRateCount: 0,
        heartRateMin: Infinity,
        heartRateMax: -Infinity,
        respRateSum: 0,
        respRateCount: 0,
        respRateMin: Infinity,
        respRateMax: -Infinity
    });

    const INITIAL_FRAMES = selectedScene.chunkLength;
    const SUBSEQUENT_FRAMES = Math.floor(selectedScene.chunkLength * 0.66);
    const OVERLAP_FRAMES = INITIAL_FRAMES - SUBSEQUENT_FRAMES;

    const {
        vitalSigns,
        performance,
        updateVitalSigns,
        updatePerformance,
        resetData
    } = useVitalSigns({
        isCapturing,
        onError: (error) => {
            setStatusMessage({
                message: `生理统计异常: ${error.message}`,
                type: 'error'
            });
        }
    });

    const videoProcessorRef = useRef<VideoProcessor | null>(null);
    const inferenceWorkerRef = useRef<Worker | null>(null);
    const progressIntervalRef = useRef<number | null>(null);

    // Initialization logic...
    useEffect(() => {
        const initializeSystem = async () => {
            try {
                if (!capabilities?.isCompatible) return;
                videoProcessorRef.current = new VideoProcessor();

                videoProcessorRef.current.faceDetector.setOnDetectionStoppedCallback(async () => {
                    if (videoProcessorRef.current) await videoProcessorRef.current.stopCapture();
                    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                    setIsCapturing(false);
                    setBufferProgress(0);
                    resetData();
                    cumulativeMetricsRef.current = {
                        heartRateSum: 0, heartRateCount: 0, heartRateMin: Infinity, heartRateMax: -Infinity,
                        respRateSum: 0, respRateCount: 0, respRateMin: Infinity, respRateMax: -Infinity
                    };
                    setStatusMessage({ message: '未检测到人脸。请重新开始采集。', type: 'warning' });
                });

                const worker = new Worker(new URL('./workers/inferenceWorker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = (e) => {
                    if (e.data.type === 'init') {
                        if (e.data.status === 'success') {
                            setIsInitialized(true);
                            setStatusMessage({ message: '系统就绪', type: 'success' });
                        } else {
                            setStatusMessage({ message: `推理模块初始化失败: ${e.data.error}`, type: 'error' });
                        }
                    } else if (e.data.type === 'inferenceResult') {
                        handleInferenceResults(e);
                    } else if (e.data.type === 'error') {
                        setStatusMessage({ message: `后台服务错误: ${e.data.error}`, type: 'error' });
                    }
                };
                inferenceWorkerRef.current = worker;
                worker.postMessage({ type: 'init', config: { modelPath: selectedScene.modelPath, configPath: selectedScene.configPath } });
            } catch (error) {
                setStatusMessage({ message: `初始化失败: ${error instanceof Error ? error.message : '未知错误'}`, type: 'error' });
            }
        };
        if (!isChecking && capabilities) initializeSystem();
        return () => {
            inferenceWorkerRef.current?.terminate();
            videoProcessorRef.current?.stopCapture();
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        };
    }, [capabilities, isChecking]);

    const handleInferenceResults = (event: MessageEvent) => {
        if (event.data.status === 'success') {
            const res: InferenceResultType = event.data;
            if (res.bvp?.filtered?.length > 0) setBufferProgress(100);
            if (res.bvp.metrics.rate > 0) {
                cumulativeMetricsRef.current.heartRateSum += res.bvp.metrics.rate;
                cumulativeMetricsRef.current.heartRateCount += 1;
                cumulativeMetricsRef.current.heartRateMin = Math.min(cumulativeMetricsRef.current.heartRateMin, res.bvp.metrics.rate);
                cumulativeMetricsRef.current.heartRateMax = Math.max(cumulativeMetricsRef.current.heartRateMax, res.bvp.metrics.rate);
            }
            updateVitalSigns({
                heartRate: res.bvp.metrics.rate, respRate: res.resp.metrics.rate,
                bvpSignal: res.bvp.raw, respSignal: res.resp.raw,
                filteredBvpSignal: res.bvp.filtered, filteredRespSignal: res.resp.filtered,
                bvpSNR: res.bvp.metrics.quality.snr, respSNR: res.resp.metrics.quality.snr,
                bvpQuality: res.bvp.metrics.quality.quality, respQuality: res.resp.metrics.quality.quality,
                actionUnits: res.actionUnits,
            });
            if (event.data.performanceMetrics) updatePerformance(event.data.performanceMetrics);
        }
    };

    const startMonitoring = useCallback(() => {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (!inferenceWorkerRef.current || !videoProcessorRef.current) return;
        frameCollectionRef.current = { frames: [], initialCollectionComplete: false, framesSinceLastInference: 0 };
        progressIntervalRef.current = window.setInterval(() => {
            const isCapturingNow = videoProcessorRef.current?.isCapturing() || false;
            if (!isCapturingNow || !isInitialized) return;
            const newFrames = videoProcessorRef.current?.getNewFrames() || [];
            if (newFrames.length > 0) {
                const { frames, initialCollectionComplete, framesSinceLastInference } = frameCollectionRef.current;
                frames.push(...newFrames);
                frameCollectionRef.current.framesSinceLastInference += newFrames.length;
                const target = initialCollectionComplete ? SUBSEQUENT_FRAMES : INITIAL_FRAMES;
                const progress = Math.min(100, (frameCollectionRef.current.framesSinceLastInference / target) * 100);
                if (!initialCollectionComplete) setBufferProgress(progress);
                else setBufferProgress(100);

                if (!initialCollectionComplete && frames.length >= INITIAL_FRAMES) {
                    inferenceWorkerRef.current?.postMessage({ type: 'inferenceResult', frameBuffer: frames.slice(-INITIAL_FRAMES), timestamp: window.performance.now(), isInitialBatch: true });
                    frameCollectionRef.current.initialCollectionComplete = true;
                    frameCollectionRef.current.framesSinceLastInference = 0;
                    frameCollectionRef.current.frames = frames.slice(-OVERLAP_FRAMES);
                } else if (initialCollectionComplete && frameCollectionRef.current.framesSinceLastInference >= SUBSEQUENT_FRAMES) {
                    inferenceWorkerRef.current?.postMessage({ type: 'inferenceResult', frameBuffer: frames.slice(-INITIAL_FRAMES), timestamp: window.performance.now(), isInitialBatch: false });
                    frameCollectionRef.current.framesSinceLastInference = 0;
                    frameCollectionRef.current.frames = frames.slice(-OVERLAP_FRAMES);
                }
            }
        }, 33);
    }, [isInitialized, INITIAL_FRAMES, SUBSEQUENT_FRAMES, OVERLAP_FRAMES]);

    const handleStartCapture = async () => {
        try {
            if (videoProcessorRef.current) await videoProcessorRef.current.reset();
            resetData();
            inferenceWorkerRef.current?.postMessage({ type: 'startCapture' });
            await videoProcessorRef.current?.startCapture();
            setIsCapturing(true);
            startMonitoring();
            setStatusMessage({ message: '正在捕获指标数据...', type: 'success' });
        } catch (e) {
            setIsCapturing(false);
            setStatusMessage({ message: '开启捕获失败', type: 'error' });
        }
    };

    const handleStopCapture = async () => {
        setIsCapturing(false);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        inferenceWorkerRef.current?.postMessage({ type: 'stopCapture' });
        await videoProcessorRef.current?.stopCapture();
        setStatusMessage({ message: '捕获已停止。', type: 'info' });
    };

    const handleVideoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !videoProcessorRef.current) return;
        try {
            setIsCapturing(true);
            await videoProcessorRef.current.loadVideoFile(file);
            startMonitoring();
            setStatusMessage({ message: `正在处理视频: ${file.name}`, type: 'success' });
        } catch (err) {
            setIsCapturing(false);
            setStatusMessage({ message: '视频加载失败', type: 'error' });
        }
    };

    const handleSceneChange = (id: SceneType) => {
        const scene = SCENES.find(s => s.id === id);
        if (!scene) return;
        setSelectedScene(scene);
        setIsInitialized(false);
        setBufferProgress(0);
        resetData();
        inferenceWorkerRef.current?.postMessage({ type: 'init', config: { modelPath: scene.modelPath, configPath: scene.configPath } });
        setStatusMessage({ message: `正在准备 ${scene.name} 场景...`, type: 'info' });
    };

    const isReady = (isCapturing || vitalSigns.heartRate > 0) && bufferProgress >= 100;
    const avgHeartRate = cumulativeMetricsRef.current.heartRateCount > 0 ? cumulativeMetricsRef.current.heartRateSum / cumulativeMetricsRef.current.heartRateCount : 0;
    const avgRespRate = cumulativeMetricsRef.current.respRateCount > 0 ? cumulativeMetricsRef.current.respRateSum / cumulativeMetricsRef.current.respRateCount : 0;

    if (isChecking) return <div className="h-screen flex items-center justify-center font-black italic uppercase text-slate-400">Initializing Biopulse...</div>;

    return (
        <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center py-12 px-6 lg:px-12 relative overflow-hidden font-sans">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_2px_2px,_rgba(0,0,0,0.02)_1px,_transparent_0)] bg-[size:32px_32px] pointer-events-none opacity-50"></div>

            <div className="w-full max-w-[1720px] flex flex-col gap-12 relative z-10">
                <header className="flex flex-col md:flex-row items-center justify-between border-b border-slate-200 pb-10 gap-8">
                    <div className="flex items-center gap-8">
                        <div className="p-5 bg-rose-500/10 rounded-[2rem] border border-rose-500/10 shadow-[0_15px_35px_rgba(225,29,72,0.1)]">
                            <Activity className="w-12 h-12 text-rose-500 animate-pulse" />
                        </div>
                        <div>
                            <h1
                                className="text-5xl font-black tracking-tighter uppercase italic leading-none flex flex-col cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setIsAboutModalOpen(true)}
                            >
                                <span className="text-slate-950">BioPulse</span>
                                <span className="text-rose-600 not-italic text-2xl mt-1">3.2 <span className="text-slate-300 text-sm italic lowercase tracking-wider ml-2">生理信号协议验证</span></span>
                            </h1>
                            <div className="mt-3">
                                <span className="text-xs text-slate-400 font-black uppercase tracking-[0.3em]">评估协议 版本 v3.2</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-shrink-0">
                        <SceneSelector
                            scenes={SCENES}
                            currentSceneId={selectedScene.id}
                            onSceneChange={handleSceneChange}
                            isCapturing={isCapturing}
                        />
                    </div>
                </header>

                <AboutModal
                    isOpen={isAboutModalOpen}
                    onClose={() => setIsAboutModalOpen(false)}
                />

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                    {/* Left Monitor: Video Feedback */}
                    <div className="lg:col-span-3 xl:col-span-4 space-y-8">
                        <div className="bg-white rounded-[3.5rem] p-10 shadow-[0_30px_70px_rgba(0,0,0,0.04)] border border-slate-200 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-slate-950 rounded-2xl text-white shadow-xl shadow-slate-950/20"><Zap className="w-6 h-6" /></div>
                                        <h2 className="text-2xl font-black text-slate-950 uppercase italic tracking-tight">实时采集监控</h2>
                                    </div>
                                    <div className="flex gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 pl-[3.25rem]">
                                        <span>请将面部置于椭圆框内</span>
                                        <span className="text-slate-300 mx-1">•</span>
                                        <span>正在使用中心区域进行处理</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 bg-slate-50 rounded-[2rem] px-5 py-3 border border-slate-100 shadow-sm relative overflow-hidden">
                                    {!isInitialized && <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-100"><div className="h-full bg-blue-500 animate-pulse" style={{ width: '40%' }}></div></div>}
                                    <div className="flex flex-col items-end gap-0.5">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em]">引擎状态</span>
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full ${isInitialized ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-amber-400 animate-pulse'}`}></div>
                                            <span className="text-sm font-black text-slate-900 uppercase tracking-tight italic">{isInitialized ? '信号锁定开启' : '引擎初始化中'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <VideoDisplay
                                videoProcessor={videoProcessorRef.current}
                                faceDetected={vitalSigns.heartRate > 0 || isCapturing}
                                bufferProgress={bufferProgress}
                                isCapturing={isCapturing}
                            />

                            <div className="mt-10 pt-10 border-t border-slate-100">
                                <Controls
                                    isInitialized={isInitialized}
                                    isCapturing={isCapturing}
                                    onStart={handleStartCapture}
                                    onStop={handleStopCapture}
                                    onVideoFileSelected={handleVideoFileSelected}
                                    onExport={() => {
                                        // Handle raw data export
                                        const exportBlob = new Blob([JSON.stringify({
                                            timestamp: new Date().toISOString(),
                                            vitalSigns,
                                            scene: selectedScene.name
                                        }, null, 2)], { type: 'application/json' });
                                        const url = URL.createObjectURL(exportBlob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `biopulse-data-${new Date().getTime()}.json`;
                                        link.click();
                                    }}
                                    onGenerateReport={() => {
                                        setReportData({
                                            metadata: {
                                                samplingRate: 30,
                                                startTime: new Date(Date.now() - 30000).toISOString(),
                                                endTime: new Date().toISOString(),
                                                totalSamples: vitalSigns.bvpSignal.length
                                            },
                                            signals: {
                                                bvp: { raw: vitalSigns.bvpSignal },
                                                resp: { raw: vitalSigns.respSignal }
                                            },
                                            rates: {
                                                heart: [{ timestamp: new Date().toISOString(), value: vitalSigns.heartRate, snr: vitalSigns.bvpSNR, quality: vitalSigns.bvpQuality }],
                                                respiratory: [{ timestamp: new Date().toISOString(), value: vitalSigns.respRate, snr: vitalSigns.respSNR, quality: vitalSigns.respQuality }]
                                            },
                                            timestamps: []
                                        });
                                    }}
                                />
                            </div>
                            <div className="mt-8 pt-8 border-t border-slate-100 relative z-10 w-full">
                                {/* Global Metrics Row placed at the very bottom INSIDE Video Capture */}
                                <GlobalMetricsRow
                                    vitalSigns={vitalSigns}
                                    avgHeartRate={avgHeartRate}
                                    avgRespRate={avgRespRate}
                                    isReady={isReady}
                                    bufferProgress={bufferProgress}
                                />
                            </div>

                            {/* Micro-grid background for the video monitor card */}
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_rgba(0,0,0,0.01)_1px,_transparent_0)] bg-[size:24px_24px] pointer-events-none opacity-40"></div>
                        </div>
                    </div>

                    {/* Right Control Hub: Main Dashboard */}
                    <div className="lg:col-span-9 xl:col-span-8 flex flex-col gap-8">
                        <div className="animate-slide-up transform-gpu">
                            <MainDashboard
                                sceneId={selectedScene.id}
                                vitalSigns={vitalSigns}
                                avgHeartRate={avgHeartRate}
                                avgRespRate={avgRespRate}
                                minHeartRate={cumulativeMetricsRef.current.heartRateMin}
                                maxHeartRate={cumulativeMetricsRef.current.heartRateMax}
                                minRespRate={cumulativeMetricsRef.current.respRateMin}
                                maxRespRate={cumulativeMetricsRef.current.respRateMax}
                                isReady={isReady}
                                bufferProgress={bufferProgress}
                            />
                        </div>
                    </div>
                </div>

                <footer className="bg-white/60 backdrop-blur-md rounded-[3rem] p-10 border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-8">
                    <div className="max-w-2xl flex items-center gap-8">
                        <div>
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 block mb-2">医学 rPPG 实验室合规性</span>
                            <p className="text-xs text-slate-500 leading-relaxed font-medium">本系统采用 rPhys 深度神经网络模型进行非接触式生理信号提取。仅作为健康参考或科研评估用途，严禁作为临床诊断依据。</p>
                        </div>
                    </div>
                    <div className="flex gap-4 items-center">
                        {statusMessage && (
                            <div className="px-5 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm text-center">
                                <span className="text-xs font-black text-slate-400 uppercase block mb-1">系统状态</span>
                                <div className="flex items-center justify-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${statusMessage.type === 'error' ? 'bg-rose-500' : statusMessage.type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'} ${statusMessage.type === 'info' ? 'animate-pulse' : ''}`} />
                                    <span className={`text-xs font-black tracking-widest lowercase ${statusMessage.type === 'error' ? 'text-rose-600' : statusMessage.type === 'warning' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {statusMessage.type === 'error' ? '系统出错' : statusMessage.type === 'warning' ? '系统警告' : '系统就绪'}
                                        {statusMessage.message ? ` - ${statusMessage.message}` : ''}
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="px-5 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm text-center">
                            <span className="text-xs font-black text-slate-400 uppercase block mb-1">编译版本</span>
                            <span className="text-xs font-black text-slate-900 tracking-widest lowercase">v3.2.0-LITE</span>
                        </div>
                        <div className="px-5 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm text-center">
                            <span className="text-xs font-black text-slate-400 uppercase block mb-1">协议同步</span>
                            <span className="text-xs font-black text-emerald-600 tracking-widest lowercase">已加密</span>
                        </div>
                    </div>
                </footer>
            </div >

            {reportData && (
                <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-xl flex items-center justify-center p-8">
                    <div id="report-container" className="report-canvas w-full max-w-5xl h-[90vh] overflow-y-auto bg-white rounded-[4rem] shadow-2xl relative">
                        <ReportView data={reportData} onClose={() => setReportData(null)} />
                    </div>
                </div>
            )}
        </div >
    );
};

export default App;