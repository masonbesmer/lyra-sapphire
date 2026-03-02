/**
 * Shared audio conversion utilities used by both recorder.ts and transcription.ts
 */

/**
 * Convert interleaved s16le stereo 48kHz PCM Buffer to mono Float32Array at 16kHz
 */
export function convertPcmToFloat32MonoResample(buffer: Buffer): Float32Array {
	const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));

	// Convert stereo to mono by averaging channels
	const samples = Math.floor(int16Array.length / 2);
	const mono = new Float32Array(samples);
	for (let i = 0; i < samples; i++) {
		const left = int16Array[i * 2] / 32768.0;
		const right = int16Array[i * 2 + 1] / 32768.0;
		mono[i] = (left + right) / 2;
	}

	// Resample via linear interpolation from 48kHz to 16kHz
	const fromRate = 48000;
	const toRate = 16000;
	if (fromRate === toRate) return mono;
	const ratio = fromRate / toRate;
	const newLen = Math.round(mono.length / ratio);
	const out = new Float32Array(newLen);
	for (let i = 0; i < newLen; i++) {
		const src = i * ratio;
		const a = Math.floor(src);
		const b = Math.min(a + 1, mono.length - 1);
		const t = src - a;
		out[i] = mono[a] * (1 - t) + mono[b] * t;
	}
	return out;
}
