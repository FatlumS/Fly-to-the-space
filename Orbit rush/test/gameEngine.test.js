/**
 * Game Engine Test Suite
 * Comprehensive tests for core game logic
 * Run: node test/gameEngine.test.js
 */

const crypto = require('crypto');

/* ============================================
   TEST UTILITIES
   ============================================ */

let testsPassed = 0;
let testsFailed = 0;
let currentTestSuite = '';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message) {
  assert(condition, message || 'Expected true, got false');
}

function assertFalse(condition, message) {
  assert(!condition, message || 'Expected false, got true');
}

function assertBetween(value, min, max, message) {
  assert(
    value >= min && value <= max,
    message || `Expected value between ${min} and ${max}, got ${value}`
  );
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    testsFailed++;
  }
}

function suite(name) {
  currentTestSuite = name;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'='.repeat(60)}`);
}

/* ============================================
   MOCK REDIS CLIENT
   ============================================ */

class MockRedis {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
  }

  async get(key) {
    if (this.ttls.has(key)) {
      const expiryTime = this.ttls.get(key);
      if (Date.now() > expiryTime) {
        this.store.delete(key);
        this.ttls.delete(key);
        return null;
      }
    }
    return this.store.get(key) || null;
  }

  async set(key, value) {
    this.store.set(key, value);
    return 'OK';
  }

  async setex(key, seconds, value) {
    this.store.set(key, value);
    this.ttls.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async del(key) {
    const existed = this.store.has(key);
    this.store.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async incr(key) {
    const current = parseInt(this.store.get(key) || '0');
    const next = current + 1;
    this.store.set(key, next.toString());
    return next;
  }

  async lpush(key, value) {
    const list = this.store.get(key) || [];
    if (typeof list === 'string') {
      list = JSON.parse(list);
    }
    list.unshift(value);
    this.store.set(key, JSON.stringify(list));
    return list.length;
  }

  async lrange(key, start, end) {
    const list = this.store.get(key) || [];
    if (typeof list === 'string') {
      list = JSON.parse(list);
    }
    if (end === -1) {
      return list.slice(start);
    }
    return list.slice(start, end + 1);
  }
}

/* ============================================
   PROVABLY FAIR IMPLEMENTATION
   ============================================ */

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

/* ============================================
   GAME STATE MANAGER (Simplified for Testing)
   ============================================ */

class GameStateManager {
  constructor(config, redis, provablyFair) {
    this.config = config;
    this.redis = redis;
    this.provablyFair = provablyFair;
    this.rounds = new Map();
    this.roundCounter = 0;
  }

  async createRound() {
    const roundId = `round-${++this.roundCounter}`;
    const serverSeed = this.provablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = 0;

    const crashPoint = this.provablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    const round = {
      id: roundId,
      serverSeed,
      clientSeed,
      nonce,
      crashPoint,
      hashedServerSeed: this.provablyFair.hashServerSeed(serverSeed),
      bets: [],
      status: 'BETTING',
      timestamp: Date.now(),
      endTime: Date.now() + this.config.ROUND_DURATION * 1000
    };

    this.rounds.set(roundId, round);
    return round;
  }

  async placeBet(playerId, roundId, amount, autoCashout = null) {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new Error('Round not found');
    }

    if (round.status !== 'BETTING') {
      throw new Error('Betting is closed for this round');
    }

    const bet = {
      id: `bet-${Date.now()}-${Math.random()}`,
      playerId,
      amount,
      autoCashout,
      cashedOut: false,
      crashedOut: false,
      payout: 0
    };

    round.bets.push(bet);
    return bet;
  }

  async transitionToFlight(roundId) {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new Error('Round not found');
    }

    round.status = 'FLYING';
    round.flightStartTime = Date.now();
    return round;
  }

  async cashoutPlayer(playerId, roundId, multiplier) {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new Error('Round not found');
    }

    const bet = round.bets.find(b => b.playerId === playerId);
    if (!bet) {
      throw new Error('Bet not found');
    }

    if (bet.cashedOut) {
      throw new Error('Already cashed out');
    }

    bet.cashedOut = true;
    bet.payout = bet.amount * multiplier;
    return bet.payout;
  }

  async processCrash(roundId) {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new Error('Round not found');
    }

    round.status = 'CRASHED';

    // Mark bets that didn't cash out
    for (const bet of round.bets) {
      if (!bet.cashedOut) {
        bet.crashedOut = true;
        bet.payout = 0;
      }
    }

    return round;
  }

  getRound(roundId) {
    return this.rounds.get(roundId);
  }

  getCurrentRound() {
    // Return the most recent round
    if (this.rounds.size === 0) return null;
    const lastRoundId = `round-${this.roundCounter}`;
    return this.rounds.get(lastRoundId);
  }
}

/* ============================================
   TEST SUITES
   ============================================ */

suite('ProvablyFair.generateCrashPoint()');

test('crash point is always >= 1.01', () => {
  for (let i = 0; i < 100; i++) {
    const serverSeed = ProvablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = i;

    const crashPoint = ProvablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    assertTrue(crashPoint >= 1.01, `Got crash point: ${crashPoint}`);
  }
});

test('crash point never exceeds 1,000,000', () => {
  for (let i = 0; i < 100; i++) {
    const serverSeed = ProvablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = i;

    const crashPoint = ProvablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    assertTrue(
      crashPoint <= 1000000,
      `Got crash point: ${crashPoint}`
    );
  }
});

test('same inputs always produce same output (deterministic)', () => {
  const serverSeed = 'test-server-seed-12345';
  const clientSeed = 'test-client-seed-67890';
  const nonce = 42;

  const crash1 = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );
  const crash2 = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );
  const crash3 = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );

  assertEquals(crash1, crash2, 'First and second should match');
  assertEquals(crash2, crash3, 'Second and third should match');
});

test('different seeds produce different results', () => {
  const baseServerSeed = 'test-server-seed';
  const baseClientSeed = 'test-client-seed';
  const nonce = 0;

  const crashes = new Set();

  for (let i = 0; i < 20; i++) {
    const serverSeed = `${baseServerSeed}-${i}`;
    const crash = ProvablyFair.generateCrashPoint(
      serverSeed,
      baseClientSeed,
      nonce
    );
    crashes.add(crash);
  }

  // Should have many different crash points
  assertTrue(
    crashes.size >= 15,
    `Expected at least 15 unique values, got ${crashes.size}`
  );
});

/* ============================================
   VERIFY CRASH POINT TESTS
   ============================================ */

suite('ProvablyFair.verifyCrashPoint()');

test('verification returns true for correct data', () => {
  const serverSeed = 'test-seed-1';
  const clientSeed = 'test-client-1';
  const nonce = 5;

  const crashPoint = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );

  const isValid = ProvablyFair.verifyCrashPoint(
    serverSeed,
    clientSeed,
    nonce,
    crashPoint
  );

  assertTrue(isValid, 'Verification should pass for correct data');
});

test('verification returns false for tampered data', () => {
  const serverSeed = 'test-seed-2';
  const clientSeed = 'test-client-2';
  const nonce = 3;

  const crashPoint = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );

  const tamperedCrashPoint = crashPoint + 0.5;

  const isValid = ProvablyFair.verifyCrashPoint(
    serverSeed,
    clientSeed,
    nonce,
    tamperedCrashPoint
  );

  assertFalse(isValid, 'Verification should fail for tampered crash point');
});

test('verification fails when server seed is changed', () => {
  const serverSeed = 'original-seed';
  const clientSeed = 'test-client';
  const nonce = 1;

  const crashPoint = ProvablyFair.generateCrashPoint(
    serverSeed,
    clientSeed,
    nonce
  );

  const isValid = ProvablyFair.verifyCrashPoint(
    'different-seed',
    clientSeed,
    nonce,
    crashPoint
  );

  assertFalse(isValid, 'Verification should fail when server seed changes');
});

/* ============================================
   CRASH POINT DISTRIBUTION TESTS
   ============================================ */

suite('Crash Point Distribution Analysis');

test('distribution shows ~50% of crashes below 2.0x', () => {
  const sampleSize = 10000;
  let belowTwo = 0;

  for (let i = 0; i < sampleSize; i++) {
    const serverSeed = ProvablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = i;

    const crashPoint = ProvablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    if (crashPoint < 2.0) {
      belowTwo++;
    }
  }

  const percentage = (belowTwo / sampleSize) * 100;
  console.log(`    Distribution: ${percentage.toFixed(2)}% below 2.0x`);

  // Should be roughly 50% ± 5%
  assertBetween(
    percentage,
    45,
    55,
    `Expected ~50% below 2.0x, got ${percentage.toFixed(2)}%`
  );
});

test('high crashes (>100x) are rare, less than 1%', () => {
  const sampleSize = 10000;
  let above100 = 0;

  for (let i = 0; i < sampleSize; i++) {
    const serverSeed = ProvablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = i;

    const crashPoint = ProvablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    if (crashPoint > 100) {
      above100++;
    }
  }

  const percentage = (above100 / sampleSize) * 100;
  console.log(`    Distribution: ${percentage.toFixed(4)}% above 100x`);

  // Should be less than 1%
  assertTrue(
    percentage < 1,
    `Expected <1% above 100x, got ${percentage.toFixed(4)}%`
  );
});

test('distribution includes full range from 1.01x to large values', () => {
  const sampleSize = 10000;
  let minCrash = Infinity;
  let maxCrash = -Infinity;

  for (let i = 0; i < sampleSize; i++) {
    const serverSeed = ProvablyFair.generateServerSeed();
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = i;

    const crashPoint = ProvablyFair.generateCrashPoint(
      serverSeed,
      clientSeed,
      nonce
    );

    minCrash = Math.min(minCrash, crashPoint);
    maxCrash = Math.max(maxCrash, crashPoint);
  }

  console.log(
    `    Range: ${minCrash.toFixed(2)}x to ${maxCrash.toFixed(2)}x`
  );

  assertTrue(minCrash >= 1.01, `Min should be >= 1.01, got ${minCrash}`);
  assertTrue(maxCrash > 10, `Max should be > 10, got ${maxCrash}`);
  assertTrue(maxCrash <= 1000000, `Max should be <= 1000000, got ${maxCrash}`);
});

/* ============================================
   GAME STATE MANAGER TESTS
   ============================================ */

suite('GameStateManager');

test('creates new round with valid crash point', async () => {
  const config = { ROUND_DURATION: 10 };
  const redis = new MockRedis();
  const provablyFair = new ProvablyFair();

  const manager = new GameStateManager(config, redis, provablyFair);
  const round = await manager.createRound();

  assertTrue(round.id !== undefined, 'Round should have an ID');
  assertTrue(round.crashPoint >= 1.01, 'Crash point should be >= 1.01');
  assertEquals(round.status, 'BETTING', 'Initial status should be BETTING');
});

test('places bet and adds to round', async () => {
  const config = { ROUND_DURATION: 10 };
  const redis = new MockRedis();
  const provablyFair = new ProvablyFair();

  const manager = new GameStateManager(config, redis, provablyFair);
  const round = await manager.createRound();

  const bet = await manager.placeBet('player1', round.id, 100, 2.5);

  assertTrue(bet.id !== undefined, 'Bet should have an ID');
  assertEquals(bet.playerId, 'player1', 'Bet should belong to player1');
  assertEquals(bet.amount, 100, 'Bet amount should be 100');
  assertEquals(bet.autoCashout, 2.5, 'Auto cashout should be 2.5');
});

test('rejects bet when round is not in betting phase', async () => {
  const config = { ROUND_DURATION: 10 };
  const redis = new MockRedis();
  const provablyFair = new ProvablyFair();

  const manager = new GameStateManager(config, redis, provablyFair);
  const round = await manager.createRound();

  await manager.transitionToFlight(round.id);

  let errorThrown = false;
  try {
    await manager.placeBet('player1', round.id, 100);
  } catch (e) {
    errorThrown = true;
  }

  assertTrue(errorThrown, 'Should throw error when round not in BETTING phase');
});

test('cashout before crash returns correct payout', async () => {
  const config = { ROUND_DURATION: 10 };
  const redis = new MockRedis();
  const provablyFair = new ProvablyFair();

  const manager = new GameStateManager(config, redis, provablyFair);
  const round = await manager.createRound();

  await manager.placeBet('player1', round.id, 100);
  await manager.transitionToFlight(round.id);

  const payout = await manager.cashoutPlayer('player1', round.id, 3.5);

  assertEquals(payout, 350, 'Payout should be 100 * 3.5 = 350');
});

test('crash marks all uncashed bets as lost', async () => {
  const config = { ROUND_DURATION: 10 };
  const redis = new MockRedis();
  const provablyFair = new ProvablyFair();

  const manager = new GameStateManager(config, redis, provablyFair);
  const round = await manager.createRound();

  await manager.placeBet('player1', round.id, 100);
  await manager.placeBet('player2', round.id, 200);

  await manager.transitionToFlight(round.id);

  // Player 1 cashes out
  await manager.cashoutPlayer('player1', round.id, 2.0);

  // Process crash
  await manager.processCrash(round.id);

  const finalRound = manager.getRound(round.id);
  const bet1 = finalRound.bets[0];
  const bet2 = finalRound.bets[1];

  assertTrue(bet1.cashedOut, 'Player 1 should have cashed out');
  assertTrue(bet2.crashedOut, 'Player 2 should have crashed out');
  assertEquals(bet2.payout, 0, 'Player 2 payout should be 0');
});

/* ============================================
   TEST SUMMARY
   ============================================ */

suite('Test Summary');

console.log(`\n${'='.repeat(60)}`);
console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log(`${'='.repeat(60)}\n`);

if (testsFailed > 0) {
  console.error(`❌ ${testsFailed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`✅ All ${testsPassed} tests passed!`);
  process.exit(0);
}
