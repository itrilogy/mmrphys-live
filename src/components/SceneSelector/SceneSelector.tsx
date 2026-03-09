// src/components/SceneSelector/SceneSelector.tsx
import React from 'react';
import { SceneConfig, SceneType } from '../../types';
import { Layers, Activity, Car, Microscope, Zap } from 'lucide-react';

interface SceneSelectorProps {
    scenes: SceneConfig[];
    currentSceneId: SceneType;
    onSceneChange: (sceneId: SceneType) => void;
    isCapturing: boolean;
}

const SceneSelector: React.FC<SceneSelectorProps> = ({
    scenes,
    currentSceneId,
    onSceneChange,
    isCapturing
}) => {
    // Icon mapping for BioPulse look
    const getIcon = (id: string) => {
        switch (id) {
            case 'lite': return <Zap className="w-5 h-5" />;
            case 'balanced': return <Activity className="w-5 h-5" />;
            case 'pro': return <Car className="w-5 h-5" />;
            case 'expert': return <Microscope className="w-5 h-5" />;
            default: return <Layers className="w-5 h-5" />;
        }
    };

    return (
        <div className="scene-selector flex gap-3">
            {scenes.map((scene) => (
                <div
                    key={scene.id}
                    className={`group relative p-4 bg-white rounded-3xl border transition-all duration-500 cursor-pointer overflow-hidden aspect-square h-[120px] w-[120px] flex flex-col justify-between
                            ${currentSceneId === scene.id
                            ? 'border-rose-500 shadow-[0_15px_30px_rgba(225,29,72,0.15)] -translate-y-1'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-lg hover:-translate-y-1'}
                            ${isCapturing ? 'opacity-40 grayscale pointer-events-none' : ''}`}
                    onClick={() => onSceneChange(scene.id)}
                >
                    {/* Background Decoration */}
                    <div className={`absolute -right-6 -top-6 w-20 h-20 rounded-full blur-2xl opacity-10 transition-colors
                            ${currentSceneId === scene.id ? 'bg-rose-500' : 'bg-slate-500'}`} />

                    <div className="relative z-10 flex justify-between items-start">
                        <div className="flex flex-col gap-2">
                            <div className={`p-2.5 rounded-2xl w-fit transition-colors
                                    ${currentSceneId === scene.id ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30' : 'bg-slate-50 text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-100'}`}>
                                {getIcon(scene.id)}
                            </div>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${currentSceneId === scene.id ? 'text-rose-500' : 'text-slate-400'}`}>
                                {scene.shortModelName}
                            </span>
                        </div>
                        {currentSceneId === scene.id && (
                            <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest border border-rose-100 px-1.5 py-0.5 rounded bg-rose-50">Active</span>
                        )}
                    </div>

                    <div className="relative z-10 mt-auto">
                        <h4 className={`text-sm font-black italic tracking-tighter uppercase leading-none mb-1 line-clamp-2
                                ${currentSceneId === scene.id ? 'text-slate-950' : 'text-slate-500 group-hover:text-slate-800'}`}>
                            {scene.name}
                        </h4>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default SceneSelector;
