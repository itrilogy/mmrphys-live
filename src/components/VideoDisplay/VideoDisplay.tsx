import React, { useEffect, useRef, useState } from 'react';
import { VideoDisplayProps } from '@/types';

const VideoDisplay: React.FC<VideoDisplayProps> = ({
    videoProcessor,
    faceDetected,
    bufferProgress,
    isCapturing
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);

    // Effect for canvas setup and cleanup
    useEffect(() => {
        if (!canvasRef.current || !videoProcessor) return;

        try {
            // Attach canvas to video processor
            videoProcessor.attachCanvas(canvasRef.current);

            // Cleanup function
            return () => {
                videoProcessor.detachCanvas();
            };
        } catch (err) {
            console.error('Canvas initialization error:', err);
            setError('Failed to initialize video display');
        }
    }, [videoProcessor]);

    return (
        <div className="video-section">
            <div className={`oval-frame ${faceDetected ? 'face-detected' : ''}`}>
                <canvas
                    ref={canvasRef}
                    width={256}
                    height={256}
                    className="w-full h-full object-cover"
                />
                {isCapturing && bufferProgress > 0 && (
                    <div className="buffer-progress">
                        <div
                            className="progress-bar"
                            style={{ width: `${bufferProgress}%` }}
                        />
                        <span className="progress-text">
                            {bufferProgress < 100
                                ? `${Math.round(bufferProgress)}% 就绪`
                                : '处理中...'}
                        </span>
                    </div>
                )}
                <div className="face-guide" />
            </div>

            {error && (
                <div className="error-message mt-2 text-error text-center">
                    {error}
                </div>
            )}

        </div>
    );
};

export default VideoDisplay;