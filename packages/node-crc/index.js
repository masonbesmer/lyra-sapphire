const crc32 = require('crc-32');
function crc(bitLength, reflect, polynomial, initLow, initHigh, xorLow, xorHigh, refOut, buffer) {
  if (bitLength !== 32) {
    throw new Error('node-crc shim only supports 32-bit CRC');
  }
  const result = crc32.buf(buffer) >>> 0;
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(result);
  return buf;
}
module.exports = { crc };
