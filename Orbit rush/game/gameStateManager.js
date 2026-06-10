const crypto = require('crypto');
const ProvablyFair = require('./provablyFair');

class GameStateManager {
  constructor(redis, gameConfig) {
    this.redis = redis;
    this.config = gameConfig;
    this.nonce = 0;
  }

  getNextNonce() {
    this.nonce += 1;
    return this.nonce;
  }

  async createRound() {
    const serverSeed = ProvablyFair.generateServerSeed();
    const hashedServerSeed = ProvablyFair.hashServerSeed(serverSeed);
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = this.getNextNonce();
    const crashPoint = ProvablyFair.generateCrashPoint(serverSeed, clientSeed, nonce);
    const roundId = `round_${Date.now()}`;
    const startTime = Date.now();

    const roundData = {
      id: roundId,
      status: 'BETTING',
      hashedServerSeed,
      clientSeed,
      crashPoint,
      nonce,
      startTime,
      endTime: startTime + (this.config.ROUND_DURATION * 1000),
      players: [],
      totalBets: 0
    };

    await this.redis.hset(this.getRoundKey(roundId), this.serializeRound(roundData));
    await this.redis.expire(this.getRoundKey(roundId), 3600);

    return roundData;
  }

  async getCurrentRound() {
    const keys = await this.redis.keys('round:round_*');

    for (const key of keys) {
      if (key.endsWith(':bets')) {
        continue;
      }

      const roundData = await this.redis.hgetall(key);
      const round = this.deserializeRound(roundData);

      if (round && (round.status === 'BETTING' || round.status === 'IN_FLIGHT')) {
        return round;
      }
    }

    return null;
  }

  async setRoundStatus(roundId, status) {
    await this.redis.hset(this.getRoundKey(roundId), 'status', status);
  }

  async transitionToFlight(roundId) {
    const flightStartTime = Date.now();

    await this.redis.hset(this.getRoundKey(roundId), {
      status: 'IN_FLIGHT',
      flightStartTime
    });

    return { status: 'IN_FLIGHT', flightStartTime };
  }

  async placeBet(roundId, playerId, amount, autoCashout = null) {
    if (amount < this.config.MIN_BET || amount > this.config.MAX_BET) {
      return { success: false, error: 'Bet amount is outside allowed limits.' };
    }

    if (
      autoCashout !== null &&
      (autoCashout < this.config.AUTO_CASHOUT_MIN || autoCashout > this.config.AUTO_CASHOUT_MAX)
    ) {
      return { success: false, error: 'Auto-cashout multiplier is outside allowed limits.' };
    }

    const round = await this.getRound(roundId);

    if (!round || round.status !== 'BETTING') {
      return { success: false, error: 'Round is not accepting bets.' };
    }

    const betData = {
      playerId,
      amount,
      autoCashout,
      timestamp: Date.now(),
      cashedOut: false,
      cashoutMultiplier: null
    };

    await this.redis.sadd(this.getBetsKey(roundId), JSON.stringify(betData));
    await this.redis.hincrbyfloat(this.getRoundKey(roundId), 'totalBets', amount);

    return { success: true, bet: betData };
  }

  async cashoutPlayer(roundId, playerId, currentMultiplier) {
    const round = await this.getRound(roundId);

    if (!round || round.status !== 'IN_FLIGHT') {
      return { success: false, error: 'Round is not in flight.' };
    }

    const betEntries = await this.redis.smembers(this.getBetsKey(roundId));
    const playerBetEntry = betEntries.find((entry) => {
      const bet = JSON.parse(entry);
      return bet.playerId === playerId;
    });

    if (!playerBetEntry) {
      return { success: false, error: 'Player bet not found.' };
    }

    const bet = JSON.parse(playerBetEntry);

    if (bet.cashedOut) {
      return { success: false, error: 'Player already cashed out.' };
    }

    if (currentMultiplier > round.crashPoint) {
      return { success: false, error: 'Cannot cash out after crash point.' };
    }

    bet.cashedOut = true;
    bet.cashoutMultiplier = currentMultiplier;

    await this.redis.srem(this.getBetsKey(roundId), playerBetEntry);
    await this.redis.sadd(this.getBetsKey(roundId), JSON.stringify(bet));

    const payout = bet.amount * currentMultiplier;

    return { success: true, payout, multiplier: currentMultiplier };
  }

  async processCrash(roundId) {
    const round = await this.getRound(roundId);

    if (!round) {
      return [];
    }

    const betEntries = await this.redis.smembers(this.getBetsKey(roundId));
    const results = betEntries.map((entry) => {
      const bet = JSON.parse(entry);
      let payout = 0;
      let multiplier = null;
      let outcome = 'lost';

      if (bet.cashedOut) {
        multiplier = bet.cashoutMultiplier;
        payout = bet.amount * bet.cashoutMultiplier;
        outcome = 'cashed_out';
      } else if (bet.autoCashout !== null && bet.autoCashout <= round.crashPoint) {
        multiplier = bet.autoCashout;
        payout = bet.amount * bet.autoCashout;
        outcome = 'auto_cashed_out';
      }

      return {
        playerId: bet.playerId,
        amount: bet.amount,
        payout,
        multiplier,
        outcome
      };
    });

    await this.redis.set(`results:${roundId}`, JSON.stringify(results));
    await this.setRoundStatus(roundId, 'CRASHED');

    return results;
  }

  async getRoundResults(roundId) {
    const results = await this.redis.get(`results:${roundId}`);
    return results ? JSON.parse(results) : null;
  }

  async getActivePlayers(roundId) {
    const betEntries = await this.redis.smembers(this.getBetsKey(roundId));
    return betEntries.map((entry) => JSON.parse(entry));
  }

  async getRoundById(roundId) {
    return this.getRound(roundId);
  }

  async getTotalBets(roundId) {
    const totalBets = await this.redis.hget(this.getRoundKey(roundId), 'totalBets');
    return totalBets ? Number(totalBets) : 0;
  }

  async resetRound() {
    const keys = await this.redis.keys('round:round_*');
    const staleBefore = Date.now() - (60 * 60 * 1000);
    let removed = 0;

    for (const key of keys) {
      if (key.endsWith(':bets')) {
        continue;
      }

      const roundData = await this.redis.hgetall(key);
      const round = this.deserializeRound(roundData);

      if (!round || round.startTime >= staleBefore) {
        continue;
      }

      await this.redis.del(key);
      await this.redis.del(this.getBetsKey(round.id));
      await this.redis.del(`results:${round.id}`);
      removed += 1;
    }

    return removed;
  }

  async getRound(roundId) {
    const roundData = await this.redis.hgetall(this.getRoundKey(roundId));
    return this.deserializeRound(roundData);
  }

  getRoundKey(roundId) {
    return `round:${roundId}`;
  }

  getBetsKey(roundId) {
    return `round:${roundId}:bets`;
  }

  serializeRound(roundData) {
    return {
      ...roundData,
      players: JSON.stringify(roundData.players)
    };
  }

  deserializeRound(roundData) {
    if (!roundData || Object.keys(roundData).length === 0) {
      return null;
    }

    return {
      ...roundData,
      crashPoint: Number(roundData.crashPoint),
      nonce: Number(roundData.nonce),
      startTime: Number(roundData.startTime),
      endTime: Number(roundData.endTime),
      flightStartTime: roundData.flightStartTime ? Number(roundData.flightStartTime) : null,
      players: roundData.players ? JSON.parse(roundData.players) : [],
      totalBets: Number(roundData.totalBets)
    };
  }
}

module.exports = GameStateManager;
