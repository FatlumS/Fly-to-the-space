require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const Redis = require('ioredis');

// Import game components
const gameConfig = require('./config/gameConfig');
const ProvablyFair = require('./game/ProvablyFair');
const GameStateManager = require('./game/GameStateManager');
const GameLoop = require('./game/GameLoop');
const setupSocketHandlers = require('./socket/socketHandlers');
const { router: casinoApi, initializeCasinoApi } = require('./api/casinoApi');

/* ============================================
   ENVIRONMENT VARIABLES
   ============================================ */

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_ENV = process.env.NODE_ENV || 'development';

/* ============================================
   EXPRESS & HTTP SETUP
   ============================================ */

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000
});

/* ============================================
   GLOBAL STATE
   ============================================ */

let redis = null;
let gameStateManager = null;
let gameLoop = null;
let isShuttingDown = false;

/* ============================================
   REDIS CLIENT INITIALIZATION
   ============================================ */

async function initializeRedis() {
  return new Promise((resolve, reject) => {
    console.log(`[REDIS] Connecting to ${REDIS_URL}...`);

    redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: false
    });

    redis.on('connect', () => {
      console.log('[REDIS] ✓ Connected successfully');
      resolve(redis);
    });

    redis.on('error', (err) => {
      console.error('[REDIS] ✗ Connection error:', err.message);
      reject(err);
    });

    redis.on('close', () => {
      console.log('[REDIS] Connection closed');
    });

    redis.on('reconnecting', () => {
      console.log('[REDIS] Attempting to reconnect...');
    });
  });
}

/* ============================================
   GAME COMPONENTS INITIALIZATION
   ============================================ */

async function initializeGameComponents() {
  try {
    // Initialize Redis first
    if (!redis) {
      await initializeRedis();
    }

    console.log('[GAME] Initializing game components...');

    // Create Provably Fair instance
    const provablyFair = new ProvablyFair(gameConfig.fairness);
    console.log('[GAME] ✓ ProvablyFair initialized');

    // Create GameStateManager instance
    gameStateManager = new GameStateManager(gameConfig, redis, provablyFair);
    console.log('[GAME] ✓ GameStateManager initialized');

    // Create GameLoop instance
    gameLoop = new GameLoop(gameStateManager, io, gameConfig);
    console.log('[GAME] ✓ GameLoop initialized');

    // Set up Socket.io handlers
    setupSocketHandlers(io, gameStateManager, gameLoop);
    console.log('[GAME] ✓ Socket handlers configured');

    console.log('[GAME] ✓ All game components initialized successfully');
    return true;
  } catch (error) {
    console.error('[GAME] ✗ Initialization failed:', error);
    throw error;
  }
}

/* ============================================
   EXPRESS ROUTES
   ============================================ */

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    components: {
      redis: redis ? (redis.status === 'ready' ? 'connected' : redis.status) : 'disconnected',
      gameStateManager: gameStateManager ? 'ready' : 'not initialized',
      gameLoop: gameLoop ? (gameLoop.isRunning ? 'running' : 'stopped') : 'not initialized',
      socketio: io ? 'active' : 'inactive'
    }
  };

  res.status(200).json(health);
});

/**
 * API Routes
 * Mount Casino API with initialized dependencies
 */
app.use('/api', casinoApi);

/**
 * Root endpoint - serve index.html
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * 404 Handler
 */
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    path: req.path
  });
});

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled error:', err);

  const status = err.status || 500;
  const message = NODE_ENV === 'development' ? err.message : 'Internal server error';

  res.status(status).json({
    status: 'error',
    message,
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

/* ============================================
   SOCKET.IO EVENT HANDLERS
   ============================================ */

io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] Client disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error) => {
    console.error(`[SOCKET] Error from ${socket.id}:`, error);
  });
});

/* ============================================
   GRACEFUL SHUTDOWN
   ============================================ */

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('[SHUTDOWN] Already shutting down, ignoring signal:', signal);
    return;
  }

  isShuttingDown = true;
  console.log(`\n[SHUTDOWN] Received ${signal}, initiating graceful shutdown...`);

  try {
    // Stop game loop
    if (gameLoop && gameLoop.isRunning) {
      console.log('[SHUTDOWN] Stopping game loop...');
      gameLoop.stop();
      console.log('[SHUTDOWN] ✓ Game loop stopped');
    }

    // Close Socket.io connections
    console.log('[SHUTDOWN] Closing Socket.io connections...');
    io.disconnectSockets();
    console.log('[SHUTDOWN] ✓ Socket.io closed');

    // Close Redis connection
    if (redis) {
      console.log('[SHUTDOWN] Closing Redis connection...');
      await redis.quit();
      console.log('[SHUTDOWN] ✓ Redis connection closed');
    }

    // Close HTTP server
    console.log('[SHUTDOWN] Closing HTTP server...');
    server.close(() => {
      console.log('[SHUTDOWN] ✓ HTTP server closed');
      console.log('[SHUTDOWN] ✓ Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('[SHUTDOWN] ✗ Forced shutdown (timeout)');
      process.exit(1);
    }, 10000);
  } catch (error) {
    console.error('[SHUTDOWN] ✗ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/* ============================================
   SERVER STARTUP
   ============================================ */

async function start() {
  try {
    console.log(`\n${'='.repeat(50)}`);
    console.log('  ORBIT RUSH - Game Server Starting');
    console.log(`${'='.repeat(50)}\n`);

    // Initialize game components
    await initializeGameComponents();

    // Initialize Casino API with dependencies
    const casinoRouter = initializeCasinoApi(redis, gameStateManager, gameLoop);

    // Start game loop
    console.log('[GAMELOOP] Starting game loop...');
    gameLoop.start();
    console.log('[GAMELOOP] ✓ Game loop started');

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`\n[SERVER] ✓ Server listening on port ${PORT}`);
      console.log(`[SERVER] Environment: ${NODE_ENV}`);
      console.log(`[SERVER] Timestamp: ${new Date().toISOString()}`);
      console.log(`\n${'='.repeat(50)}\n`);

      // Log available endpoints
      console.log('Available Endpoints:');
      console.log('  GET  /health');
      console.log('  GET  /api/history');
      console.log('  GET  /api/verify/:roundId');
      console.log('  POST /api/auth');
      console.log('  POST /api/bet');
      console.log('  POST /api/cashout');
      console.log('  POST /api/rollback');
      console.log('\nWebSocket Connection: ws://localhost:' + PORT);
      console.log(`\n${'='.repeat(50)}\n`);
    });

  } catch (error) {
    console.error('\n[STARTUP] ✗ Failed to start server:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Start the server
start();

/* ============================================
   EXPORTS (for testing)
   ============================================ */

module.exports = {
  app,
  server,
  io,
  redis,
  gameStateManager,
  gameLoop
};
