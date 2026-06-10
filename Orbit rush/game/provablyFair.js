const crypto = require('crypto');

class ProvablyFair {
  static generateServerSeed() {
    return crypto.randomBytes(32).toString('hex');
  }

  static hashServerSeed(serverSeed) {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  static generateCrashPoint(serverSeed, clientSeed, nonce) {
    const combinedSeed = `${serverSeed}-${clientSeed}-${nonce}`;
    const hash = crypto.createHash('sha256').update(combinedSeed).digest('hex');
    const hashSlice = hash.slice(0, 13);
    const intValue = parseInt(hashSlice, 16);
    const randomNumber = intValue / (Math.pow(2, 52) - 1);

    const crashPoint = (1 / (1 - randomNumber)) * 0.96;
    const flooredCrashPoint = Math.floor(crashPoint * 100) / 100;

    return Math.min(Math.max(flooredCrashPoint, 1.01), 1000000);
  }

  static verifyCrashPoint(serverSeed, clientSeed, nonce, claimedCrashPoint) {
    const crashPoint = this.generateCrashPoint(serverSeed, clientSeed, nonce);
    return crashPoint === claimedCrashPoint;
  }
}

module.exports = ProvablyFair;
