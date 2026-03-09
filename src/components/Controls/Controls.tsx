import React from 'react';
import { ControlsProps } from '@/types';

const Controls: React.FC<ControlsProps> = ({
    isCapturing,
    isInitialized,
    onStart,
    onStop,
    onExport,
    onGenerateReport,
    onVideoFileSelected
}) => {
    return (
        <div className="controls">
            <button
                className="btn-biopulse-secondary"
                onClick={() => document.getElementById('video-file-input')?.click()}
                disabled={isCapturing}
                title="加载视频文件进行分析"
            >
                <span className="text-lg">📁</span>
                加载视频
            </button>
            <input
                id="video-file-input"
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={onVideoFileSelected}
            />
            <button
                className="btn-biopulse-primary"
                onClick={onStart}
                disabled={!isInitialized || isCapturing}
            >
                <span className="text-lg">▶</span>
                开始捕获
            </button>

            <button
                className="btn-biopulse-secondary"
                onClick={onStop}
                disabled={!isCapturing}
            >
                <span className="text-lg">⏹</span>
                停止捕获
            </button>

            <button
                className="btn-biopulse-secondary"
                onClick={onExport}
                disabled={isCapturing}
                title="导出原始 JSON 数据"
            >
                <span className="text-lg">⬇</span>
                导出数据
            </button>

            <button
                className="btn-biopulse-accent"
                onClick={onGenerateReport}
                disabled={isCapturing}
                title="生成可视化 PDF 检测报告"
            >
                <span className="text-lg">📋</span>
                生成报告
            </button>
        </div>
    );
};

export default Controls;