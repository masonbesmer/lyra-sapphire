/**
 * Wake-word + VAD worker.
 *
 * One worker per process, not per guild: the models are a few MB and inference is
 * sub-millisecond, so a single worker multiplexes every guild and user cheaply.
 *
 * Shapes and tensor names here were measured, not guessed — see "openWakeWord chain,
 * validated" in the plan. In particular the names are not what you would expect
 * (`input_1` -> `conv2d_19`, `x.1` -> `53`) and `inputMetadata.dims` is empty for every
 * model, so nothing about the layout is discoverable at runtime.
 */
import { parentPort, workerData } from 'node:worker_threads';
import * as ort from 'onnxruntime-node';
import { FRAME_SAMPLES, SAMPLE_RATE, type FromWorkerMessage, type StreamKey, type ToWorkerMessage } from './types';

const MEL_BINS = 32;
const EMB_WINDOW = 76; // mel frames per embedding
const EMB_STRIDE = 8; // mel frames between embeddings
const EMB_COUNT = 16; // embeddings the classifier expects
const EMB_SIZE = 96;
const PREROLL_FRAMES = 4; // ~320 ms, so a clipped first word still reaches STT
const MIN_UTTERANCE_MS = 250; // shorter than this is a false accept, not speech
const VAD_SPEECH_THRESHOLD = 0.5;
// The mel model uses a 640-sample window with a 160 hop, so it yields (n/160 - 3) frames.
// Feeding each 1280-sample frame independently therefore loses 3 frames of overlap every
// time — measured as 335 mel frames where a batch run over the same audio gives 534, and
// scores 50x lower. Carrying the last 640-160 samples forward restores the missing context
// and yields exactly 8 frames per audio frame, matching batch.
const MEL_CONTEXT = 480;

interface StreamState {
	mel: Float32Array[]; // rolling mel frames, each MEL_BINS long
	melBase: number; // absolute index of mel[0], so the embedding grid survives trimming
	nextEmbedStart: number; // absolute index of the next embedding window
	embeddings: Float32Array[];
	preroll: Float32Array[];
	capture: Float32Array[];
	capturing: boolean;
	silentFrames: number;
	audioTail: Float32Array;
	vadH: ort.Tensor;
	vadC: ort.Tensor;
	sensitivity: number;
	silenceMs: number;
	maxMs: number;
	/**
	 * Serialises frame processing for this stream. Frames arrive faster than inference
	 * completes, so firing them concurrently let every frame read `capturing === false`
	 * before the first one had finished — the capture branch was never taken and mel rows
	 * interleaved out of order. Order matters here; concurrency does not help.
	 */
	queue: Promise<void>;
}

const port = parentPort;
if (!port) throw new Error('detectWorker must be run as a worker thread');

// No transfer list: lib.dom's MessagePort wins overload resolution here, so Node's
// transferList form does not typecheck. Structured-cloning a frame is ~5 KB at 12.5/s per
// user, which is not worth a cast that could hide a real error.
const post = (message: FromWorkerMessage) => port.postMessage(message);

const modelsDir: string = workerData?.modelsDir ?? './models';
const wakeModel: string = workerData?.wakeModel ?? 'hey_jarvis_v0.1';

let mel!: ort.InferenceSession;
let emb!: ort.InferenceSession;
let wake!: ort.InferenceSession;
let vad!: ort.InferenceSession;

const streams = new Map<StreamKey, StreamState>();

const zeroState = () => new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);

function newStream(): StreamState {
	return {
		mel: [],
		melBase: 0,
		nextEmbedStart: 0,
		embeddings: [],
		preroll: [],
		capture: [],
		capturing: false,
		silentFrames: 0,
		audioTail: new Float32Array(MEL_CONTEXT),
		vadH: zeroState(),
		vadC: zeroState(),
		sensitivity: 0.5,
		silenceMs: 600,
		maxMs: 8000,
		queue: Promise.resolve()
	};
}

async function load() {
	const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['cpu'] };
	[mel, emb, wake, vad] = await Promise.all([
		ort.InferenceSession.create(`${modelsDir}/melspectrogram.onnx`, opts),
		ort.InferenceSession.create(`${modelsDir}/embedding_model.onnx`, opts),
		ort.InferenceSession.create(`${modelsDir}/${wakeModel}.onnx`, opts),
		ort.InferenceSession.create(`${modelsDir}/silero_vad.onnx`, opts)
	]);
}

/** Appends the mel frames for one audio frame, and returns a wake score when one is due. */
async function scoreWake(state: StreamState, pcm: Float32Array): Promise<number | null> {
	// Prepend the carried context so the mel frames are contiguous across frame boundaries.
	const withContext = new Float32Array(MEL_CONTEXT + pcm.length);
	withContext.set(state.audioTail, 0);
	withContext.set(pcm, MEL_CONTEXT);
	state.audioTail = pcm.slice(pcm.length - MEL_CONTEXT);

	const melOut = await mel.run({
		[mel.inputNames[0]]: new ort.Tensor('float32', withContext, [1, withContext.length])
	});
	const out = melOut[mel.outputNames[0]];
	const frames = out.dims[2] as number;
	const data = out.data as Float32Array;

	for (let f = 0; f < frames; f++) {
		const row = new Float32Array(MEL_BINS);
		// openWakeWord's transform. Without it the embeddings are meaningless — and it fails
		// as bad scores, not as an error.
		for (let b = 0; b < MEL_BINS; b++) row[b] = data[f * MEL_BINS + b] / 10 + 2;
		state.mel.push(row);
	}

	// Embeddings sit on a fixed grid anchored at the start of the stream — multiples of
	// EMB_STRIDE mel frames — exactly as openWakeWord does. Using a trailing window instead
	// lands on an off-grid phase, and the classifier is brutally sensitive to it: measured
	// 0.983 on-grid against 0.006 four frames off, on identical audio.
	let produced = false;
	while (state.melBase + state.mel.length - state.nextEmbedStart >= EMB_WINDOW) {
		const local = state.nextEmbedStart - state.melBase;
		const window = new Float32Array(EMB_WINDOW * MEL_BINS);
		for (let f = 0; f < EMB_WINDOW; f++) window.set(state.mel[local + f], f * MEL_BINS);

		const embOut = await emb.run({
			[emb.inputNames[0]]: new ort.Tensor('float32', window, [1, EMB_WINDOW, MEL_BINS, 1])
		});
		state.embeddings.push(Float32Array.from(embOut[emb.outputNames[0]].data as Float32Array));
		if (state.embeddings.length > EMB_COUNT) state.embeddings.shift();
		state.nextEmbedStart += EMB_STRIDE;
		produced = true;
	}

	// Only drop rows the next window can no longer need.
	const drop = state.nextEmbedStart - state.melBase;
	if (drop > 0) {
		state.mel.splice(0, drop);
		state.melBase += drop;
	}

	if (!produced || state.embeddings.length < EMB_COUNT) return null;

	const flat = new Float32Array(EMB_COUNT * EMB_SIZE);
	state.embeddings.forEach((e, i) => flat.set(e, i * EMB_SIZE));
	const wakeOut = await wake.run({
		[wake.inputNames[0]]: new ort.Tensor('float32', flat, [1, EMB_COUNT, EMB_SIZE])
	});
	return (wakeOut[wake.outputNames[0]].data as Float32Array)[0];
}

/** Silero is stateful: h/c must be threaded across calls or endpointing degrades silently. */
async function isSpeech(state: StreamState, pcm: Float32Array): Promise<boolean> {
	const out = await vad.run({
		input: new ort.Tensor('float32', pcm, [1, pcm.length]),
		sr: new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []),
		h: state.vadH,
		c: state.vadC
	});
	state.vadH = out.hn as ort.Tensor;
	state.vadC = out.cn as ort.Tensor;
	return (out.output.data as Float32Array)[0] >= VAD_SPEECH_THRESHOLD;
}

function finishUtterance(key: StreamKey, state: StreamState) {
	const frames = state.capture;
	state.capturing = false;
	state.capture = [];
	state.silentFrames = 0;
	// A wake hit restarts detection from scratch, so stale embeddings cannot re-trigger.
	state.embeddings = [];

	const total = frames.reduce((n, f) => n + f.length, 0);
	const durationMs = (total / SAMPLE_RATE) * 1000;
	if (durationMs < MIN_UTTERANCE_MS) return;

	const pcm = new Float32Array(total);
	let offset = 0;
	for (const f of frames) {
		pcm.set(f, offset);
		offset += f.length;
	}
	post({ type: 'utterance', key, pcm, durationMs });
}

async function onFrame(key: StreamKey, pcm: Float32Array) {
	const state = streams.get(key);
	if (!state) return;

	if (state.capturing) {
		state.capture.push(pcm);
		state.silentFrames = (await isSpeech(state, pcm)) ? 0 : state.silentFrames + 1;

		const frameMs = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;
		const capturedMs = state.capture.length * frameMs;
		if (state.silentFrames * frameMs >= state.silenceMs || capturedMs >= state.maxMs) {
			finishUtterance(key, state);
		}
		return;
	}

	state.preroll.push(pcm);
	if (state.preroll.length > PREROLL_FRAMES) state.preroll.shift();

	const score = await scoreWake(state, pcm);
	if (score !== null && score >= state.sensitivity) {
		post({ type: 'wake', key, score });
		state.capturing = true;
		state.silentFrames = 0;
		state.capture = [...state.preroll];
		state.preroll = [];
	}
}

port.on('message', (message: ToWorkerMessage) => {
	try {
		switch (message.type) {
			case 'register':
				if (!streams.has(message.key)) streams.set(message.key, newStream());
				break;
			case 'unregister':
				streams.delete(message.key);
				break;
			case 'config': {
				const state = streams.get(message.key) ?? newStream();
				state.sensitivity = message.sensitivity;
				state.silenceMs = message.silenceMs;
				state.maxMs = message.maxMs;
				streams.set(message.key, state);
				break;
			}
			case 'frame': {
				const state = streams.get(message.key);
				if (!state) break;
				// Chained, not fired: see StreamState.queue. Errors are swallowed per frame so
				// one bad frame cannot kill detection for every guild.
				state.queue = state.queue
					.then(() => onFrame(message.key, message.pcm))
					.catch((error) => post({ type: 'error', key: message.key, message: String(error) }));
				break;
			}
		}
	} catch (error) {
		post({ type: 'error', key: null, message: String(error) });
	}
});

load()
	.then(() => post({ type: 'ready' }))
	.catch((error) => post({ type: 'error', key: null, message: `model load failed: ${String(error)}` }));
