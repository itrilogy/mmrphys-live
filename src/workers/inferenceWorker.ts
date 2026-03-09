// src/workers/inferenceWorker.ts
/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { ApplicationPaths, Paths } from '@/utils/paths';
import { SignalProcessor } from '../utils/signalProcessor';
import { configService, ModelConfig } from '../services/configService';

import {
    SignalBuffers,
    PerformanceMetrics,
    SignalMetrics,
    InferenceResult,
    WorkerMessage,
    ExportData
} from '../types';


// Add a global flag at the top of the file, outside the class
let isShuttingDown = false;
let globalStopRequested = false;

class InferenceWorker {
    private session: ort.InferenceSession | null = null;
    public signalProcessor: SignalProcessor | null = null;
    public isInitialized = false;
    private inputName: string = '';
    private MIN_FRAMES_REQUIRED = 181; // Will be updated from config
    private fps: number = 30;
    private modelConfig: ModelConfig | null = null;
    private frameHeight: number = 72;  // Will be updated from config
    private frameWidth: number = 72;   // Will be updated from config
    private sequenceLength: number = 181; // Will be updated from config
    private _preprocessingTensor: ort.Tensor | null = null;
    private _preprocessingBuffer: Float32Array | null = null;
    private _additionalTensors: { [key: string]: ort.Tensor } = {};

    async initialize(config?: {
        modelPath?: string;
        configPath?: string;
        initialFrames?: number;
        subsequentFrames?: number;
    }): Promise<void> {
        const currentModelPath = config?.modelPath || this.modelConfig?.model_path;

        // Only skip if already initialized with the EXACT same configuration
        if (this.isInitialized &&
            this.modelConfig?.model_path === currentModelPath &&
            this.sequenceLength === (config?.initialFrames || this.sequenceLength)) {
            console.log('[InferenceWorker] Worker already initialized with same model and sequence length, skipping.');
            return;
        }

        try {
            this.isInitialized = false; // Mark as not ready during transition

            // EXPLICITLY DISPOSE PREVIOUS SESSION TO FREE MEMORY
            if (this.session) {
                console.log('[InferenceWorker] Disposing previous session before re-initialization');
                await this.session.release();
                this.session = null;
            }

            // Configure environment if not already done
            await this.configureOrtEnvironment();

            // Initialize the signal processor if not exists
            if (!this.signalProcessor) {
                this.signalProcessor = new SignalProcessor();
            }

            // Load model configuration using ConfigService
            console.log('[InferenceWorker] Loading model configuration...', config?.configPath || 'default');
            this.modelConfig = await configService.getConfig(config?.configPath);

            if (!this.modelConfig) {
                throw new Error('Failed to load model configuration');
            }

            // Get dimensions from config, handling both array and object (BigSmall) formats
            const isBigSmall = this.modelConfig.modelType === 'BigSmall' || !Array.isArray(this.modelConfig.input_size);

            if (isBigSmall && this.modelConfig.input_size && (this.modelConfig.input_size as any).big) {
                const bigInput = (this.modelConfig.input_size as any).big;
                this.frameWidth = bigInput[3] || 144;
                this.frameHeight = bigInput[2] || 144;
                this.sequenceLength = this.modelConfig.FRAME_NUM || bigInput[0] || 3;
            } else {
                const inputArr = this.modelConfig.input_size as number[];
                this.frameWidth = inputArr[4] || 72;
                this.frameHeight = inputArr[3] || 72;
                this.sequenceLength = this.modelConfig.FRAME_NUM || inputArr[2] || 181;
            }
            this.MIN_FRAMES_REQUIRED = this.sequenceLength;

            console.log(`[InferenceWorker] Dimensions: ${this.frameWidth}x${this.frameHeight}, Seq: ${this.sequenceLength}`);

            // Update sampling rate from config
            if (this.modelConfig.sampling_rate) {
                this.fps = this.modelConfig.sampling_rate;
            }

            // Create session using config values or provided path
            const modelPath = config?.modelPath || this.modelConfig.model_path;
            await this.createSession(modelPath);

            // Re-initialize signal processor with potentially new FPS and segment config
            const initialFrames = config?.initialFrames || this.sequenceLength;
            const subsequentFrames = config?.subsequentFrames || Math.floor(initialFrames * 0.66);

            this.signalProcessor = new SignalProcessor(this.fps, initialFrames, subsequentFrames);

            // Warm up model and processor
            await this.warmup();

            this.isInitialized = true;
            self.postMessage({ type: 'init', status: 'success' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[InferenceWorker] Initialization error:', errorMessage);
            self.postMessage({
                type: 'init',
                status: 'error',
                error: `Initialization failed: ${errorMessage}`
            });
        }
    }

    private async configureOrtEnvironment(): Promise<void> {
        try {
            ort.env.wasm.wasmPaths = {
                'ort-wasm.wasm': ApplicationPaths.ortWasm('ort-wasm.wasm'),
                'ort-wasm-simd.wasm': ApplicationPaths.ortWasm('ort-wasm-simd.wasm'),
                'ort-wasm-threaded.wasm': ApplicationPaths.ortWasm('ort-wasm-threaded.wasm'),
                'ort-wasm-simd-threaded.wasm': ApplicationPaths.ortWasm('ort-wasm-simd-threaded.wasm')
            };

            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = true;

            console.log('[InferenceWorker] ONNX Runtime environment configured');
        } catch (error) {
            console.error('[InferenceWorker] Failed to configure ONNX Runtime:', error);
            throw error;
        }
    }

    private async createSession(customModelPath?: string): Promise<void> {
        try {
            // Use provided path or fall back to config path
            const modelPath = customModelPath || this.modelConfig?.model_path;

            if (!modelPath) {
                throw new Error('No model path provided');
            }

            console.log(`[InferenceWorker] Loading model from: ${modelPath}`);

            // Ensure we use absolute path for fetching if it doesn't start with /
            const fetchPath = modelPath.startsWith('http') || modelPath.startsWith('/')
                ? modelPath
                : `/${modelPath}`;

            this.session = await ort.InferenceSession.create(fetchPath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                executionMode: 'sequential',
                enableCpuMemArena: true,
                enableMemPattern: true,
                logSeverityLevel: 0,
                logVerbosityLevel: 0,
                intraOpNumThreads: 1,
                interOpNumThreads: 1
            });

            if (!this.session) {
                throw new Error('Failed to create ONNX session');
            }

            this.inputName = this.session.inputNames[0];
            console.log('[InferenceWorker] Session created successfully');
            console.log('[InferenceWorker] Input names:', this.session.inputNames);
            console.log('[InferenceWorker] Output names:', this.session.outputNames);
        } catch (error) {
            console.error('[InferenceWorker] Failed to create ONNX session:', error);
            throw error;
        }
    }

    private async warmup(): Promise<void> {
        if (!this.session || !this.signalProcessor) return;

        try {
            const config = this.modelConfig as any;
            console.log(`[InferenceWorker] Warming up ${config?.modelType || 'standard'} model...`);
            const framesToCreate = this.MIN_FRAMES_REQUIRED || 181;
            const dummyFrames: ImageData[] = [];
            for (let i = 0; i < framesToCreate; i++) {
                dummyFrames.push(new ImageData(this.frameWidth || 72, this.frameHeight || 72));
            }
            const feeds = this.preprocessFrames(dummyFrames);
            await this.session.run(feeds);
            console.log('[InferenceWorker] Warmup successfully completed');
        } catch (error) {
            console.warn('[InferenceWorker] Warmup failed (non-fatal):', error);
        }
    }

    private preprocessFrames(frameBuffer: ImageData[]): { [key: string]: ort.Tensor } {
        if (frameBuffer.length < this.MIN_FRAMES_REQUIRED) {
            throw new Error(`Insufficient frames. Need ${this.MIN_FRAMES_REQUIRED}, got ${frameBuffer.length}`);
        }

        const frames = frameBuffer.slice(-this.MIN_FRAMES_REQUIRED);
        const config = this.modelConfig as any;
        const modelType = config?.modelType || 'Balanced';

        // 1. TS-CAN (6 channels: Diff + Raw)
        if (modelType === 'TSCAN') {
            const T = frames.length;
            const H = this.frameHeight;
            const W = this.frameWidth;
            const buffer = new Float32Array(T * 6 * H * W);

            for (let f = 0; f < T; f++) {
                const current = frames[f].data;
                const prev = frames[f > 0 ? f - 1 : 0].data;
                for (let i = 0; i < H * W; i++) {
                    const pos = i * 4;
                    const offset = f * (6 * H * W) + i;
                    for (let c = 0; c < 3; c++) {
                        const cVal = current[pos + c];
                        const pVal = prev[pos + c];
                        buffer[offset + c * (H * W)] = (cVal - pVal) / (cVal + pVal + 1e-7);
                        buffer[offset + (c + 3) * (H * W)] = cVal / 255.0;
                    }
                }
            }
            return { 'input': new ort.Tensor('float32', buffer, [T, 6, H, W]) };
        }

        // 2. BigSmall (Dual input)
        if (modelType === 'BigSmall') {
            const T = frames.length;
            const H = this.frameHeight;
            const W = this.frameWidth;
            const bigData = new Float32Array(T * 3 * H * W);
            const smallData = new Float32Array(T * 3 * 9 * 9);

            for (let f = 0; f < T; f++) {
                const data = frames[f].data;
                // Big input (144x144)
                for (let i = 0; i < H * W; i++) {
                    bigData[f * (3 * H * W) + 0 * (H * W) + i] = data[i * 4] / 255.0;
                    bigData[f * (3 * H * W) + 1 * (H * W) + i] = data[i * 4 + 1] / 255.0;
                    bigData[f * (3 * H * W) + 2 * (H * W) + i] = data[i * 4 + 2] / 255.0;
                }

                // Small input (9x9) - Uniform downsampling
                const strideH = Math.floor(H / 9);
                const strideW = Math.floor(W / 9);
                for (let sh = 0; sh < 9; sh++) {
                    for (let sw = 0; sw < 9; sw++) {
                        const srcIdx = ((sh * strideH) * W + (sw * strideW)) * 4;
                        const dstIdx = f * (3 * 81) + sh * 9 + sw;
                        smallData[dstIdx] = data[srcIdx] / 255.0;
                        smallData[dstIdx + 81] = data[srcIdx + 1] / 255.0;
                        smallData[dstIdx + 162] = data[srcIdx + 2] / 255.0;
                    }
                }
            }

            return {
                'big_input': new ort.Tensor('float32', bigData, [T, 3, H, W]),
                'small_input': new ort.Tensor('float32', smallData, [T, 3, 9, 9])
            };
        }

        // 3. Standard 3D CNN (Balanced, PhysNet, PhysFormer)
        const shape = [1, 3, this.sequenceLength, this.frameHeight, this.frameWidth];
        const dataSize = shape.reduce((a, b) => a * b);
        if (!this._preprocessingBuffer || this._preprocessingBuffer.length !== dataSize) {
            this._preprocessingBuffer = new Float32Array(dataSize);
        }

        const frameStride = this.frameHeight * this.frameWidth;
        const channelStride = this.sequenceLength * frameStride;

        if (modelType === 'PhysFormer') {
            // PhysFormer expects DiffNormalized input: (x[t+1] - x[t]) / (x[t+1] + x[t] + eps)
            for (let f = 0; f < frames.length; f++) {
                const currentData = frames[f].data;
                const nextData = frames[f < frames.length - 1 ? f + 1 : f].data;

                for (let h = 0; h < this.frameHeight; h++) {
                    for (let w = 0; w < this.frameWidth; w++) {
                        const pixelPos = (h * this.frameWidth + w) * 4;
                        const pixelOffset = f * frameStride + h * this.frameWidth + w;

                        for (let c = 0; c < 3; c++) {
                            const cVal = nextData[pixelPos + c];
                            const pVal = currentData[pixelPos + c];
                            const diffVal = (f < frames.length - 1)
                                ? (cVal - pVal) / (cVal + pVal + 1e-7)
                                : 0;
                            this._preprocessingBuffer[c * channelStride + pixelOffset] = diffVal;
                        }
                    }
                }
            }

            // Global standard deviation normalization as required by PhysFormer/PhysNet
            let sum = 0;
            for (let i = 0; i < dataSize; i++) sum += this._preprocessingBuffer[i];
            const mean = sum / dataSize;

            let sqDiffSum = 0;
            for (let i = 0; i < dataSize; i++) sqDiffSum += Math.pow(this._preprocessingBuffer[i] - mean, 2);
            const std = Math.sqrt(sqDiffSum / dataSize + 1e-6);

            for (let i = 0; i < dataSize; i++) {
                this._preprocessingBuffer[i] = (this._preprocessingBuffer[i] - mean) / std;
            }
        } else {
            // Standard Z-Score for other models (Balanced, PhysNet if not DiffNormalized)
            for (let f = 0; f < frames.length; f++) {
                const frameData = frames[f].data;
                for (let h = 0; h < this.frameHeight; h++) {
                    for (let w = 0; w < this.frameWidth; w++) {
                        const pixelPos = (h * this.frameWidth + w) * 4;
                        const pixelOffset = f * frameStride + h * this.frameWidth + w;
                        this._preprocessingBuffer[pixelOffset] = frameData[pixelPos];
                        this._preprocessingBuffer[channelStride + pixelOffset] = frameData[pixelPos + 1];
                        this._preprocessingBuffer[2 * channelStride + pixelOffset] = frameData[pixelPos + 2];
                    }
                }
            }

            const normalizationDataSize = 3 * this.sequenceLength * this.frameHeight * this.frameWidth;
            let mean = 0;
            let std = 0;

            for (let i = 0; i < normalizationDataSize; i++) mean += this._preprocessingBuffer[i];
            mean /= normalizationDataSize;

            for (let i = 0; i < normalizationDataSize; i++) std += (this._preprocessingBuffer[i] - mean) ** 2;
            std = Math.sqrt(std / normalizationDataSize + 1e-6);

            for (let i = 0; i < dataSize; i++) {
                this._preprocessingBuffer[i] = (this._preprocessingBuffer[i] - mean) / std;
            }
        }

        const feeds: { [key: string]: ort.Tensor } = {
            'input': new ort.Tensor('float32', this._preprocessingBuffer, shape)
        };

        if (modelType === 'PhysFormer') {
            feeds['gra_sharp'] = new ort.Tensor('float32', new Float32Array([1.0]), []);
        }

        return feeds;
    }

    private async processFrames(frameBuffer: ImageData[]): Promise<SignalBuffers | null> {
        if (!this.session || !this.signalProcessor) {
            throw new Error('Worker not initialized');
        }

        if (!this.signalProcessor.isCapturing) {
            return null;
        }

        if (!frameBuffer || frameBuffer.length < this.MIN_FRAMES_REQUIRED) {
            return null;
        }

        try {
            const inferenceStartTime = performance.now();
            const feeds = this.preprocessFrames(frameBuffer);
            const results = await this.session.run(feeds);
            const timestamp = new Date().toISOString();

            if (this.signalProcessor) {
                this.signalProcessor.setInferenceTime(performance.now() - inferenceStartTime);
            }

            // Flexible output parsing
            const outputNames = Object.keys(results);
            const bvpKey = outputNames.find(k => k.toLowerCase().includes('bvp') || k === 'output' || k === 'rPPG');
            const respKey = outputNames.find(k => k.toLowerCase().includes('resp') || k === 'rRSP');
            const auKey = outputNames.find(k => k.toLowerCase().includes('au'));

            if (!bvpKey) {
                console.error('[InferenceWorker] Missing BVP output in results. Available keys:', outputNames);
                throw new Error('Missing BVP output');
            }

            const bvpData = results[bvpKey].data as Float32Array;
            const respData = respKey ? (results[respKey].data as Float32Array) : bvpData; // If no explicit resp, use bvp for cross-channel extraction

            let actionUnits: number[] | undefined = undefined;
            if (auKey) {
                const rawAus = Array.from(results[auKey].data as Float32Array);
                actionUnits = rawAus.slice(-12);
            }

            // Important: Use signalProcessor for core filtering and rate calculation
            const processedSignals = this.signalProcessor.processNewSignals(
                Array.from(bvpData),
                Array.from(respData),
                timestamp
            );

            return {
                bvp: {
                    raw: processedSignals.displayData.bvp,
                    filtered: processedSignals.displayData.filteredBvp || [],
                    metrics: processedSignals.bvp
                },
                resp: {
                    raw: processedSignals.displayData.resp,
                    filtered: processedSignals.displayData.filteredResp || [],
                    metrics: processedSignals.resp
                },
                actionUnits,
                timestamp
            };
        } catch (error) {
            console.error('[InferenceWorker] processFrames error:', error);
            throw error;
        }
    }

    async runInference(frames: ImageData[]): Promise<void> {
        if (!this.signalProcessor || !this.isInitialized || isShuttingDown || globalStopRequested) return;
        if (!this.signalProcessor.isCapturing) return;

        try {
            const processingStart = performance.now();
            const processedSignals = await this.processFrames(frames);

            if (!processedSignals || isShuttingDown || !this.signalProcessor.isCapturing) return;

            self.postMessage({
                type: 'inferenceResult',
                status: 'success',
                bvp: processedSignals.bvp,
                resp: processedSignals.resp,
                actionUnits: (processedSignals as any).actionUnits,
                timestamp: processedSignals.timestamp,
                performanceMetrics: {
                    averageUpdateTime: performance.now() - processingStart,
                    updateCount: 1,
                    bufferUtilization: 100
                }
            });
        } catch (error) {
            console.error('[InferenceWorker] runInference error:', error);
            self.postMessage({ type: 'inferenceResult', status: 'error', error: String(error) });
        }
    }

    async exportData(): Promise<void> {
        try {
            if (!this.signalProcessor) throw new Error('Signal processor not' + ' initialized');
            const data = this.signalProcessor.getExportData();
            if (!data?.signals?.bvp?.raw?.length && !data?.signals?.resp?.raw?.length) {
                throw new Error('No data to export');
            }
            self.postMessage({ type: 'exportData', status: 'success', data: JSON.stringify(data) });
        } catch (error) {
            self.postMessage({ type: 'exportData', status: 'error', error: String(error) });
        }
    }

    startCapture(): void {
        isShuttingDown = false;
        globalStopRequested = false;
        if (!this.signalProcessor) throw new Error('No signal processor');
        this.signalProcessor.startCapture();
        this.signalProcessor.isCapturing = true;
        console.log('[InferenceWorker] Signal capture started');
    }

    stopCapture(): void {
        console.log('[InferenceWorker] Stop capture requested');
        if (this.signalProcessor) {
            this.signalProcessor.stopCapture();
            this.signalProcessor.isCapturing = false;
        }
        self.postMessage({ type: 'stopCapture', status: 'success' });
    }

    reset(): void {
        isShuttingDown = false;
        globalStopRequested = false;
        if (this.signalProcessor) {
            this.signalProcessor.reset();
            this.signalProcessor.isCapturing = false;
        }
        this.isInitialized = true;
        self.postMessage({ type: 'reset', status: 'success' });
    }

    async dispose(): Promise<void> {
        if (this.session) {
            await this.session.release();
            this.session = null;
        }
        this.signalProcessor = null;
        this.isInitialized = false;
    }
}

// Create worker instance
const worker = new InferenceWorker();


// Message handler
self.onmessage = async (e: MessageEvent) => {
    try {
        // Special handling for reset - always process regardless of state
        if (e.data.type === 'reset') {
            console.log('[InferenceWorker] Resetting worker state');
            // Reset global flags
            isShuttingDown = false;
            globalStopRequested = false;
            worker.reset();
            self.postMessage({ type: 'reset', status: 'success' });
            return;
        }

        // Special handling for stopCapture - process this immediately with highest priority
        if (e.data.type === 'stopCapture') {
            console.log('[InferenceWorker] Emergency stop requested');
            worker.stopCapture();
            return;
        }

        // Handle export even in shutdown state - we want to be able to export after stopping
        if (e.data.type === 'exportData') {
            await worker.exportData();
            return;
        }

        // For all other messages, if we're shutting down, ignore them
        if (isShuttingDown || globalStopRequested) {
            console.log(`[InferenceWorker] Ignoring message of type ${e.data.type} - worker is shutting down`);
            return;
        }

        // For inference requests, check if we're supposed to be capturing
        if (e.data.type === 'inferenceResult' &&
            (!worker.signalProcessor || !worker.signalProcessor.isCapturing)) {
            console.log(`[InferenceWorker] Ignoring inference request - capture inactive`);
            return;
        }

        switch (e.data.type) {
            case 'init':
                await worker.initialize(e.data.config);
                // Placeholder for BigSmall multi-task parsing logic if needed
                if (e.data.config?.modelType === 'BigSmall') {
                    console.log('[InferenceWorker] Initialized for BigSmall multi-task model.');
                    // Add specific BigSmall model parsing/setup logic here
                }
                break;
            case 'startCapture':
                try {
                    console.log('[InferenceWorker] Starting capture');

                    if (worker.signalProcessor) {
                        // Ensure clean state before starting (defensive programming)
                        worker.signalProcessor.reset();
                        worker.signalProcessor.startCapture();
                    }

                    if (worker.signalProcessor) {
                        worker.signalProcessor.isCapturing = true;
                    }

                    self.postMessage({
                        type: 'startCapture',
                        status: 'success'
                    });
                } catch (error) {
                    self.postMessage({
                        type: 'startCapture',
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Failed to start capture'
                    });
                }
                break;
            case 'inferenceResult':
                await worker.runInference(e.data.frameBuffer);
                break;
            default:
                console.warn(`[InferenceWorker] Unknown message type: ${e.data.type}`);
                self.postMessage({
                    type: e.data.type,
                    status: 'error',
                    error: `Unknown message type: ${e.data.type}`
                });
        }
    } catch (error) {
        console.error('Worker error:', error);
        self.postMessage({
            type: e.data.type,
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

// Error handling with proper type checking
self.addEventListener('error', (event: ErrorEvent) => {
    console.error('Worker error:', event);
    self.postMessage({
        type: 'error',
        status: 'error',
        error: event.message || 'Unknown error occurred'
    });
});

// Unhandled rejection handling with proper type checking
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    console.error('Unhandled rejection in worker:', event.reason);
    self.postMessage({
        type: 'error',
        status: 'error',
        error: event.reason instanceof Error ? event.reason.message : String(event.reason)
    });
});

// Export empty object to satisfy TypeScript module requirements
export { };