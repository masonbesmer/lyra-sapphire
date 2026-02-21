export function crc(
	bitLength: number,
	reflect: boolean,
	polynomial: number,
	initLow: number,
	initHigh: number,
	xorLow: number,
	xorHigh: number,
	refOut: boolean,
	buffer: Buffer
): Buffer;
