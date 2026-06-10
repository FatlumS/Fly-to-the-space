function setupSocketHandlers(io, gameStateManager, gameLoop) {
  const playerBalances = new Map();
  const lastBetTimestamps = new Map();
  const startingBalance = 1000;
  const betCooldownMs = 5000;

  io.on('connection', async (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.playerId = socket.id;
    ensurePlayerBalance(socket.playerId, playerBalances, startingBalance);

    try {
      const currentRound = await gameStateManager.getCurrentRound();

      if (currentRound) {
        socket.emit('CURRENT_ROUND', {
          currentRound,
          multiplier: getCurrentMultiplier(gameLoop, currentRound.id)
        });
      }
    } catch (error) {
      socket.emit('SOCKET_ERROR', { message: 'Unable to load current round.' });
    }

    socket.on('PING', () => {
      socket.emit('PONG');
    });

    socket.on('JOIN_GAME', async ({ playerId } = {}) => {
      try {
        socket.playerId = playerId || socket.id;
        const balance = ensurePlayerBalance(socket.playerId, playerBalances, startingBalance);

        const currentRound = await gameStateManager.getCurrentRound();

        socket.emit('JOINED', {
          playerId: socket.playerId,
          currentRound
        });
        socket.emit('BALANCE_UPDATE', { balance });

        if (currentRound) {
          socket.emit('MULTIPLIER_UPDATE', {
            roundId: currentRound.id,
            multiplier: getCurrentMultiplier(gameLoop, currentRound.id).toFixed(2)
          });
        }
      } catch (error) {
        socket.emit('SOCKET_ERROR', { message: 'Unable to join game.' });
      }
    });

    socket.on('PLACE_BET', async ({ amount, autoCashout } = {}) => {
      try {
        const playerId = socket.playerId;
        const now = Date.now();
        const lastBetAt = lastBetTimestamps.get(playerId) || 0;
        const betAmount = Number(amount);

        if (now - lastBetAt < betCooldownMs) {
          socket.emit('BET_ERROR', { message: 'Please wait before placing another bet.' });
          return;
        }

        if (!Number.isFinite(betAmount) || betAmount <= 0) {
          socket.emit('BET_ERROR', { message: 'Invalid bet amount.' });
          return;
        }

        const balance = ensurePlayerBalance(playerId, playerBalances, startingBalance);

        if (balance < betAmount) {
          socket.emit('BET_ERROR', { message: 'Insufficient balance.' });
          return;
        }

        const currentRound = await gameStateManager.getCurrentRound();

        if (!currentRound) {
          socket.emit('BET_ERROR', { message: 'No active round available.' });
          return;
        }

        const result = await gameStateManager.placeBet(
          currentRound.id,
          playerId,
          betAmount,
          autoCashout == null ? null : Number(autoCashout)
        );

        if (!result.success) {
          socket.emit('BET_ERROR', { message: result.error });
          return;
        }

        const updatedBalance = balance - betAmount;
        playerBalances.set(playerId, updatedBalance);
        lastBetTimestamps.set(playerId, now);

        socket.emit('BET_CONFIRMED', {
          roundId: currentRound.id,
          bet: result.bet
        });
        socket.emit('BALANCE_UPDATE', { balance: updatedBalance });

        socket.broadcast.emit('PLAYER_BET', {
          playerId: maskPlayerId(playerId),
          amount: result.bet.amount
        });
      } catch (error) {
        socket.emit('BET_ERROR', { message: 'Unable to place bet.' });
      }
    });

    socket.on('CASH_OUT', async () => {
      try {
        const playerId = socket.playerId;
        const currentRound = await gameStateManager.getCurrentRound();

        if (!currentRound) {
          socket.emit('CASHOUT_ERROR', { message: 'No active round available.' });
          return;
        }

        const currentMultiplier = gameLoop.getCurrentMultiplier();

        if (!currentMultiplier || gameLoop.getCurrentRoundId() !== currentRound.id) {
          socket.emit('CASHOUT_ERROR', { message: 'No active multiplier available.' });
          return;
        }

        const result = await gameStateManager.cashoutPlayer(
          currentRound.id,
          playerId,
          currentMultiplier
        );

        if (!result.success) {
          socket.emit('CASHOUT_ERROR', { message: result.error });
          return;
        }

        const balance = ensurePlayerBalance(playerId, playerBalances, startingBalance);
        const updatedBalance = balance + result.payout;
        playerBalances.set(playerId, updatedBalance);

        socket.emit('CASHOUT_SUCCESS', {
          multiplier: result.multiplier,
          payout: result.payout
        });
        socket.emit('BALANCE_UPDATE', { balance: updatedBalance });

        io.emit('PLAYER_CASHED_OUT', {
          playerId: maskPlayerId(playerId),
          multiplier: result.multiplier
        });
      } catch (error) {
        socket.emit('CASHOUT_ERROR', { message: 'Unable to cash out.' });
      }
    });

    socket.on('REQUEST_HISTORY', async () => {
      try {
        const history = await getRoundHistory(gameStateManager.redis);
        socket.emit('HISTORY_DATA', history);
      } catch (error) {
        socket.emit('HISTORY_DATA', []);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      delete socket.playerId;
    });
  });
}

function ensurePlayerBalance(playerId, playerBalances, startingBalance) {
  if (!playerBalances.has(playerId)) {
    playerBalances.set(playerId, startingBalance);
  }

  return playerBalances.get(playerId);
}

function getCurrentMultiplier(gameLoop, roundId) {
  if (gameLoop.getCurrentRoundId() === roundId && gameLoop.getCurrentMultiplier()) {
    return Number(gameLoop.getCurrentMultiplier());
  }

  return 1.00;
}

async function getRoundHistory(redis) {
  const keys = await redis.keys('round:round_*');
  const history = [];

  for (const key of keys) {
    if (key.endsWith(':bets')) {
      continue;
    }

    const round = await redis.hgetall(key);

    if (!round || Object.keys(round).length === 0 || round.status !== 'CRASHED') {
      continue;
    }

    history.push({
      roundId: round.id,
      crashPoint: Number(round.crashPoint),
      timestamp: Number(round.startTime)
    });
  }

  return history
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);
}

function maskPlayerId(id) {
  if (!id || id.length <= 6) {
    return `${id || ''}***`;
  }

  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

module.exports = setupSocketHandlers;
