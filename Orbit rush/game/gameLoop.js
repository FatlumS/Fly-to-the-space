class GameLoop {
  constructor(gameStateManager, io, gameConfig) {
    this.gameStateManager = gameStateManager;
    this.io = io;
    this.config = gameConfig;
    this.interval = null;
    this.isRunning = false;
    this.currentRoundId = null;
    this.currentMultiplier = 1.00;
  }

  start() {
    this.runLoop();

    const cycleTime = (
      this.config.ROUND_DURATION +
      this.config.FLIGHT_TRANSITION +
      this.config.CRASH_PAUSE
    ) * 1000 + 2000;

    this.interval = setInterval(() => this.runLoop(), cycleTime);
  }

  async runLoop() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const round = await this.gameStateManager.createRound();
      const roundId = round.id;
      this.currentRoundId = roundId;
      this.currentMultiplier = 1.00;

      this.io.emit('ROUND_STARTING', {
        roundId,
        hashedServerSeed: round.hashedServerSeed,
        bettingEndsAt: round.endTime,
        countdown: this.config.ROUND_DURATION
      });

      await this.sleep(this.config.ROUND_DURATION * 1000);

      const flight = await this.gameStateManager.transitionToFlight(roundId);

      this.io.emit('GAME_FLYING', {
        roundId,
        flightStartTime: Date.now()
      });

      const crashPoint = round.crashPoint;
      const flightStartTime = flight.flightStartTime;
      let currentMultiplier = 1.00;

      while (currentMultiplier < crashPoint) {
        const elapsed = (Date.now() - flightStartTime) / 1000;
        currentMultiplier = Math.pow(Math.E, elapsed * 0.05);
        this.currentMultiplier = currentMultiplier;

        this.io.emit('MULTIPLIER_UPDATE', {
          roundId,
          multiplier: currentMultiplier.toFixed(2)
        });

        await this.sleep(100);
      }

      await this.gameStateManager.processCrash(roundId);
      this.currentMultiplier = 1.00;

      this.io.emit('GAME_CRASHED', {
        roundId,
        crashPoint,
        serverSeed: round.serverSeed,
        clientSeed: round.clientSeed,
        nonce: round.nonce
      });

      const results = await this.gameStateManager.getRoundResults(roundId);
      this.io.emit('ROUND_RESULTS', {
        roundId,
        results
      });
      this.currentRoundId = null;

      await this.sleep(this.config.CRASH_PAUSE * 1000);
    } catch (error) {
      console.error('Game loop error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  getCurrentMultiplier() {
    return this.currentMultiplier;
  }

  getCurrentRoundId() {
    return this.currentRoundId;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    console.log('Game loop stopped');
  }
}

module.exports = GameLoop;
