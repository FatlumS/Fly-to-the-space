/**
 * Casino Integration API
 * Express Router for casino operations and game management
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Assume these are injected or imported
let redis = null;
let gameStateManager = null;
let gameLoop = null;

/**
 * Initialize the casino API router with dependencies
 */
function initializeCasinoApi(redisClient, gameManager, gameLoopInstance) {
  redis = redisClient;
  gameStateManager = gameManager;
  gameLoop = gameLoopInstance;
  return router;
}

/* ============================================
   RATE LIMITING MIDDLEWARE
   ============================================ */

/**
 * In-memory rate limiter
 * Simple counter per IP address
 */
const rateLimitStore = new Map();

function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.lastReset > 1000) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup every 2 seconds
setInterval(cleanupRateLimitStore, 2000);

/**
 * Rate limiting middleware for bet/cashout endpoints
 * Limit: 10 requests per second per IP
 */
function rateLimitBetCashout(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, lastReset: now });
    return next();
  }

  const limiter = rateLimitStore.get(ip);

  // Reset counter if more than 1 second has passed
  if (now - limiter.lastReset >= 1000) {
    limiter.count = 1;
    limiter.lastReset = now;
    return next();
  }

  // Increment counter
  limiter.count++;

  // Check if exceeded limit (10 per second)
  if (limiter.count > 10) {
    return res.status(429).json({
      status: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Maximum 10 requests per second.',
      retryAfter: 1000 - (now - limiter.lastReset)
    });
  }

  next();
}

/* ============================================
   VALIDATION HELPERS
   ============================================ */

/**
 * Validate session token from Redis
 */
async function validateSession(sessionToken) {
  if (!redis) {
    throw new Error('Redis client not initialized');
  }

  const session = await redis.get(`session:${sessionToken}`);
  if (!session) {
    return null;
  }

  return JSON.parse(session);
}

/**
 * Validate bet amount
 */
function validateBetAmount(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num < 1 || num > 100000) {
    return { valid: false, error: 'Bet amount must be between 1 and 100000' };
  }
  return { valid: true };
}

/**
 * Validate auto cashout value
 */
function validateAutoCashout(autoCashout) {
  if (autoCashout === null || autoCashout === undefined) {
    return { valid: true };
  }

  const num = parseFloat(autoCashout);
  if (isNaN(num) || num < 1 || num > 10000) {
    return { valid: false, error: 'Auto cashout must be between 1.00x and 10000x' };
  }
  return { valid: true };
}

/* ============================================
   ENDPOINTS
   ============================================ */

/**
 * POST /api/auth
 * Authenticate player and create session
 */
router.post('/auth', async (req, res) => {
  try {
    const { token, casinoId, playerId } = req.body;

    // Validate inputs
    if (!token || token.trim() === '') {
      return res.status(400).json({
        status: 'AUTH_FAILED',
        message: 'Invalid or missing token'
      });
    }

    if (!playerId) {
      return res.status(400).json({
        status: 'AUTH_FAILED',
        message: 'Player ID is required'
      });
    }

    // Generate session token
    const sessionToken = uuidv4();

    // Create session object
    const session = {
      playerId,
      casinoId: casinoId || 'default',
      balance: 100000,
      currency: 'USD',
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    // Store session in Redis with 1 hour expiry
    if (redis) {
      await redis.setex(
        `session:${sessionToken}`,
        3600, // 1 hour
        JSON.stringify(session)
      );
    }

    return res.status(200).json({
      status: 'AUTH_SUCCESS',
      sessionToken,
      playerId,
      balance: session.balance,
      currency: session.currency,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('Auth endpoint error:', error);
    return res.status(500).json({
      status: 'AUTH_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/bet
 * Place a bet on the current round
 */
router.post('/bet', rateLimitBetCashout, async (req, res) => {
  try {
    const { sessionToken, amount, autoCashout } = req.body;

    // Validate session
    if (!sessionToken) {
      return res.status(401).json({
        status: 'BET_FAILED',
        message: 'Session token is required'
      });
    }

    const session = await validateSession(sessionToken);
    if (!session) {
      return res.status(401).json({
        status: 'BET_FAILED',
        message: 'Invalid or expired session'
      });
    }

    // Validate amount
    const amountValidation = validateBetAmount(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        status: 'BET_FAILED',
        message: amountValidation.error
      });
    }

    // Validate auto cashout
    const autoCashoutValidation = validateAutoCashout(autoCashout);
    if (!autoCashoutValidation.valid) {
      return res.status(400).json({
        status: 'BET_FAILED',
        message: autoCashoutValidation.error
      });
    }

    // Check balance
    if (session.balance < amount) {
      return res.status(400).json({
        status: 'BET_FAILED',
        message: 'Insufficient balance',
        requiredBalance: amount,
        currentBalance: session.balance
      });
    }

    // Get current round
    if (!gameStateManager) {
      return res.status(500).json({
        status: 'BET_FAILED',
        message: 'Game state manager not initialized'
      });
    }

    const currentRound = gameStateManager.getCurrentRound();
    if (!currentRound || currentRound.status !== 'BETTING') {
      return res.status(400).json({
        status: 'BET_FAILED',
        message: 'Betting is not open for current round',
        currentStatus: currentRound?.status
      });
    }

    // Deduct from balance
    const newBalance = session.balance - amount;
    session.balance = newBalance;
    session.lastActivity = Date.now();

    // Update session in Redis
    if (redis) {
      await redis.setex(
        `session:${sessionToken}`,
        3600,
        JSON.stringify(session)
      );
    }

    // Place bet via game state manager
    const betResult = gameStateManager.placeBet({
      playerId: session.playerId,
      roundId: currentRound.roundId,
      amount: parseFloat(amount),
      autoCashout: autoCashout ? parseFloat(autoCashout) : null,
      sessionToken
    });

    return res.status(200).json({
      status: 'BET_PLACED',
      roundId: currentRound.roundId,
      amount: parseFloat(amount),
      autoCashout: autoCashout ? parseFloat(autoCashout) : null,
      balance: newBalance,
      betId: betResult.betId
    });
  } catch (error) {
    console.error('Bet endpoint error:', error);
    return res.status(500).json({
      status: 'BET_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/cashout
 * Cash out from current round
 */
router.post('/cashout', rateLimitBetCashout, async (req, res) => {
  try {
    const { sessionToken } = req.body;

    // Validate session
    if (!sessionToken) {
      return res.status(401).json({
        status: 'CASHOUT_FAILED',
        message: 'Session token is required'
      });
    }

    const session = await validateSession(sessionToken);
    if (!session) {
      return res.status(401).json({
        status: 'CASHOUT_FAILED',
        message: 'Invalid or expired session'
      });
    }

    if (!gameStateManager || !gameLoop) {
      return res.status(500).json({
        status: 'CASHOUT_FAILED',
        message: 'Game services not initialized'
      });
    }

    // Get current round and multiplier
    const currentRound = gameStateManager.getCurrentRound();
    const currentMultiplier = gameLoop.getCurrentMultiplier();

    if (!currentRound || currentRound.status !== 'FLYING') {
      return res.status(400).json({
        status: 'CASHOUT_FAILED',
        message: 'Game is not in flight phase'
      });
    }

    // Get player bet
    const playerBet = currentRound.bets.find(b => b.playerId === session.playerId);
    if (!playerBet) {
      return res.status(400).json({
        status: 'CASHOUT_FAILED',
        message: 'No active bet found for this player'
      });
    }

    if (playerBet.cashedOut) {
      return res.status(400).json({
        status: 'CASHOUT_FAILED',
        message: 'Already cashed out this round'
      });
    }

    // Calculate payout
    const payout = playerBet.amount * currentMultiplier;
    const profit = payout - playerBet.amount;

    // Update session balance
    session.balance += payout;
    session.lastActivity = Date.now();

    // Update session in Redis
    if (redis) {
      await redis.setex(
        `session:${sessionToken}`,
        3600,
        JSON.stringify(session)
      );
    }

    // Call game state manager to process cashout
    gameStateManager.cashoutPlayer({
      playerId: session.playerId,
      roundId: currentRound.roundId,
      multiplier: currentMultiplier,
      payout
    });

    return res.status(200).json({
      status: 'CASHED_OUT',
      multiplier: currentMultiplier.toFixed(2),
      betAmount: playerBet.amount,
      payout: payout.toFixed(2),
      profit: profit.toFixed(2),
      balance: session.balance.toFixed(2)
    });
  } catch (error) {
    console.error('Cashout endpoint error:', error);
    return res.status(500).json({
      status: 'CASHOUT_ERROR',
      message: error.message
    });
  }
});

/**
 * POST /api/rollback
 * Casino operator endpoint to rollback transactions
 */
router.post('/rollback', (req, res) => {
  try {
    const { casinoId, transactionId, reason } = req.body;
    const apiKey = process.env.CASINO_API_KEY;

    // Validate API key
    if (!apiKey || casinoId !== apiKey) {
      return res.status(403).json({
        status: 'ROLLBACK_FAILED',
        message: 'Invalid casino credentials'
      });
    }

    // Validate transaction ID
    if (!transactionId) {
      return res.status(400).json({
        status: 'ROLLBACK_FAILED',
        message: 'Transaction ID is required'
      });
    }

    // Log rollback attempt
    console.log(`[ROLLBACK] Transaction: ${transactionId}, Reason: ${reason || 'Not specified'}`);

    // TODO: Implement actual rollback logic
    // - Find transaction in database
    // - Reverse balance changes
    // - Mark transaction as rolled back

    return res.status(200).json({
      status: 'ROLLBACK_PROCESSED',
      transactionId,
      processedAt: new Date().toISOString(),
      reason: reason || 'Not specified'
    });
  } catch (error) {
    console.error('Rollback endpoint error:', error);
    return res.status(500).json({
      status: 'ROLLBACK_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/history
 * Get last 50 round results
 */
router.get('/history', (req, res) => {
  try {
    if (!gameStateManager) {
      return res.status(500).json({
        status: 'HISTORY_ERROR',
        message: 'Game state manager not initialized'
      });
    }

    // Get round history (last 50)
    const history = gameStateManager.getRoundHistory(50);

    if (!history || history.length === 0) {
      return res.status(200).json({
        status: 'SUCCESS',
        count: 0,
        history: [],
        message: 'No rounds available yet'
      });
    }

    // Format history for response
    const formattedHistory = history.map(round => ({
      roundId: round.roundId,
      crashPoint: round.crashPoint ? round.crashPoint.toFixed(2) : null,
      timestamp: round.timestamp,
      playerCount: round.bets ? round.bets.length : 0,
      status: round.status
    }));

    return res.status(200).json({
      status: 'SUCCESS',
      count: formattedHistory.length,
      history: formattedHistory
    });
  } catch (error) {
    console.error('History endpoint error:', error);
    return res.status(500).json({
      status: 'HISTORY_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/verify/:roundId
 * Verify fairness of a round - returns cryptographic proof
 */
router.get('/verify/:roundId', (req, res) => {
  try {
    const { roundId } = req.params;

    if (!roundId) {
      return res.status(400).json({
        status: 'VERIFY_FAILED',
        message: 'Round ID is required'
      });
    }

    if (!gameStateManager) {
      return res.status(500).json({
        status: 'VERIFY_ERROR',
        message: 'Game state manager not initialized'
      });
    }

    // Get round verification data
    const verificationData = gameStateManager.getVerificationData(roundId);

    if (!verificationData) {
      return res.status(404).json({
        status: 'VERIFY_FAILED',
        message: 'Round not found'
      });
    }

    return res.status(200).json({
      status: 'VERIFIED',
      roundId,
      serverSeed: verificationData.serverSeed,
      serverSeedHash: verificationData.serverSeedHash,
      clientSeed: verificationData.clientSeed,
      nonce: verificationData.nonce,
      crashPoint: verificationData.crashPoint ? verificationData.crashPoint.toFixed(2) : null,
      timestamp: verificationData.timestamp,
      // Include instructions for verification
      verificationUrl: `https://your-domain.com/verify?roundId=${roundId}`,
      algorithm: 'SHA-256'
    });
  } catch (error) {
    console.error('Verify endpoint error:', error);
    return res.status(500).json({
      status: 'VERIFY_ERROR',
      message: error.message
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    redisConnected: redis ? 'yes' : 'no',
    gameStateManagerReady: gameStateManager ? 'yes' : 'no',
    gameLoopRunning: gameLoop ? gameLoop.isRunning() : 'no'
  };

  res.status(200).json(health);
});

/**
 * Error handling middleware
 */
router.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(err.status || 500).json({
    status: 'ERROR',
    message: err.message || 'Internal server error'
  });
});

/* ============================================
   EXPORTS
   ============================================ */

module.exports = {
  router,
  initializeCasinoApi,
  rateLimitBetCashout
};
