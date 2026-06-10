/**
 * OrbitRushClient - Complete client-side game controller
 * Vanilla JavaScript implementation for the Fly to the Space game
 */

class OrbitRushClient {
  constructor() {
    // Initialize DOM element references
    this.balanceDisplay = document.getElementById('balance-display');
    this.betAmountInput = document.getElementById('bet-amount');
    this.autoCashoutInput = document.getElementById('auto-cashout');
    this.placeBetButton = document.getElementById('place-bet-btn');
    this.cashOutButton = document.getElementById('cashout-btn');
    this.multiplierDisplay = document.getElementById('multiplier-display');
    this.countdownTimer = document.getElementById('countdown-timer');
    this.gameStatusMessage = document.getElementById('game-status');
    this.spaceshipContainer = document.getElementById('spaceship-container');
    this.socialFeed = document.getElementById('social-feed');
    this.historyContainer = document.getElementById('history-sidebar');
    this.gameContainer = document.getElementById('game-container');

    // Initialize state
    this.state = {
      balance: 1000,
      currentBet: null,
      isBetting: false,
      hasCashedOut: false,
      currentRoundId: null
    };

    // Socket.io instance
    this.socket = null;

    // Animation variables
    this.countdownInterval = null;
    this.multiplierAnimation = null;
    this.feedItems = [];
    this.maxFeedItems = 20;
  }

  /**
   * Initialize the client - connect to server and set up listeners
   */
  init() {
    // Connect to Socket.io
    this.socket = io();

    // Set up listeners
    this.setupSocketListeners();
    this.setupUIListeners();

    // Request round history
    this.socket.emit('REQUEST_HISTORY');

    // Display initial balance
    this.updateBalanceDisplay(this.state.balance);

    console.log('OrbitRushClient initialized');
  }

  /**
   * Set up all Socket.io event listeners
   */
  setupSocketListeners() {
    // ROUND_STARTING: Show countdown and enable betting
    this.socket.on('ROUND_STARTING', (data) => {
      this.resetForNewRound();
      this.gameStatusMessage.textContent = 'Place your bets!';
      this.gameStatusMessage.classList.remove('crashed');
      this.gameStatusMessage.classList.add('betting');
      this.placeBetButton.disabled = false;
      this.placeBetButton.textContent = 'Place Bet';
      this.placeBetButton.classList.remove('cashout-mode');

      // Start countdown
      this.startCountdown(data.countdownTime || 10);
    });

    // GAME_FLYING: Spaceship is flying, disable bets, show cash out button
    this.socket.on('GAME_FLYING', (data) => {
      this.state.currentRoundId = data.roundId;
      this.gameStatusMessage.textContent = '🚀 FLYING...';
      this.gameStatusMessage.classList.remove('betting', 'crashed');
      this.gameStatusMessage.classList.add('flying');
      
      this.placeBetButton.textContent = 'CASH OUT';
      this.placeBetButton.classList.add('cashout-mode', 'pulse');
      this.placeBetButton.disabled = false;
      
      this.betAmountInput.disabled = true;
      this.autoCashoutInput.disabled = true;
      this.state.isBetting = false;
    });

    // MULTIPLIER_UPDATE: Update display and animate spaceship
    this.socket.on('MULTIPLIER_UPDATE', (data) => {
      this.multiplierDisplay.textContent = `${data.multiplier.toFixed(2)}x`;
      this.updateSpaceship(data.multiplier);
    });

    // GAME_CRASHED: Show crash animation and results
    this.socket.on('GAME_CRASHED', (data) => {
      this.gameStatusMessage.textContent = `CRASHED at ${data.crashPoint.toFixed(2)}x!`;
      this.gameStatusMessage.classList.remove('flying', 'betting');
      this.gameStatusMessage.classList.add('crashed');
      
      this.playShakeAnimation();
      
      this.placeBetButton.textContent = 'Place Bet';
      this.placeBetButton.classList.remove('cashout-mode', 'pulse');
      this.placeBetButton.disabled = true;
      
      this.state.hasCashedOut = false;
      
      // Reset multiplier display after a moment
      setTimeout(() => {
        this.multiplierDisplay.textContent = '1.00x';
        this.resetSpaceship();
      }, 1500);
    });

    // PLAYER_BET: Add to social feed
    this.socket.on('PLAYER_BET', (data) => {
      this.addToFeed(`Player ${data.playerId} bet ${data.amount}`, 'bet');
    });

    // PLAYER_CASHED_OUT: Add to social feed with profit
    this.socket.on('PLAYER_CASHED_OUT', (data) => {
      const profit = (data.amount * data.multiplier - data.amount).toFixed(2);
      this.addToFeed(`Player ${data.playerId} cashed out at ${data.multiplier.toFixed(2)}x! +${profit}`, 'cashout');
    });

    // HISTORY_DATA: Populate history sidebar
    this.socket.on('HISTORY_DATA', (data) => {
      this.populateHistory(data.history);
    });

    // BET_CONFIRMED: Store bet and update balance
    this.socket.on('BET_CONFIRMED', (data) => {
      this.state.currentBet = {
        amount: data.amount,
        autoCashout: data.autoCashout
      };
      this.state.balance -= data.amount;
      this.updateBalanceDisplay(this.state.balance);
      this.addToFeed(`You bet ${data.amount}`, 'bet');
    });

    // CASHOUT_SUCCESS: Update balance and show win animation
    this.socket.on('CASHOUT_SUCCESS', (data) => {
      const winnings = data.winAmount;
      const previousBalance = this.state.balance;
      this.state.balance = data.newBalance;
      
      this.playWinAnimation();
      this.updateBalanceDisplay(this.state.balance);
      
      this.addToFeed(`You cashed out at ${data.multiplier.toFixed(2)}x! +${(winnings - this.state.currentBet.amount).toFixed(2)}`, 'cashout');
      
      this.state.currentBet = null;
      this.state.hasCashedOut = false;
      
      // Reset UI for next round
      setTimeout(() => {
        this.resetForNewRound();
      }, 2000);
    });

    // BALANCE_UPDATE: Update balance display
    this.socket.on('BALANCE_UPDATE', (data) => {
      this.updateBalanceDisplay(data.balance);
      this.state.balance = data.balance;
    });
  }

  /**
   * Set up all UI event listeners
   */
  setupUIListeners() {
    // Place Bet button click
    this.placeBetButton.addEventListener('click', () => {
      if (this.placeBetButton.textContent === 'Place Bet') {
        this.placeBet();
      } else if (this.placeBetButton.textContent === 'CASH OUT') {
        this.cashOut();
      }
    });

    // Bet amount input validation
    this.betAmountInput.addEventListener('input', () => {
      const amount = parseFloat(this.betAmountInput.value) || 0;
      
      // Minimum bet
      if (amount < 1) {
        this.betAmountInput.classList.add('error');
      } else if (amount > this.state.balance) {
        this.betAmountInput.classList.add('error');
      } else {
        this.betAmountInput.classList.remove('error');
      }
    });

    // Auto cashout input validation
    this.autoCashoutInput.addEventListener('input', () => {
      const value = this.autoCashoutInput.value;
      
      // Validate format (should be a number >= 1)
      if (value && isNaN(parseFloat(value))) {
        this.autoCashoutInput.classList.add('error');
      } else if (value && parseFloat(value) < 1) {
        this.autoCashoutInput.classList.add('error');
      } else {
        this.autoCashoutInput.classList.remove('error');
      }
    });
  }

  /**
   * Place a bet
   */
  placeBet() {
    const amount = parseFloat(this.betAmountInput.value);
    const autoCashout = this.autoCashoutInput.value ? parseFloat(this.autoCashoutInput.value) : null;

    // Validate amount
    if (!amount || amount < 1) {
      this.gameStatusMessage.textContent = 'Minimum bet is 1';
      this.gameStatusMessage.classList.add('error');
      return;
    }

    if (amount > this.state.balance) {
      this.gameStatusMessage.textContent = 'Insufficient balance';
      this.gameStatusMessage.classList.add('error');
      return;
    }

    // Validate auto cashout
    if (autoCashout && autoCashout < 1) {
      this.gameStatusMessage.textContent = 'Auto cashout must be >= 1.00x';
      this.gameStatusMessage.classList.add('error');
      return;
    }

    // Emit bet event
    this.socket.emit('PLACE_BET', {
      amount: amount,
      autoCashout: autoCashout
    });

    // Disable inputs
    this.betAmountInput.disabled = true;
    this.autoCashoutInput.disabled = true;
    this.state.isBetting = true;
    this.gameStatusMessage.classList.remove('error');
  }

  /**
   * Cash out from current round
   */
  cashOut() {
    if (this.state.hasCashedOut) {
      return;
    }

    this.socket.emit('CASH_OUT');
    this.state.hasCashedOut = true;
    this.placeBetButton.disabled = true;
    this.placeBetButton.classList.remove('pulse');
  }

  /**
   * Update spaceship position based on multiplier
   */
  updateSpaceship(multiplier) {
    const spaceship = this.spaceshipContainer.querySelector('.spaceship');
    if (!spaceship) return;

    // Move spaceship upward based on multiplier
    // Scale: each 0.1x increase moves it up by some pixels
    const maxHeight = 80; // Maximum percentage of container height
    const heightPercent = Math.min(multiplier * 10, maxHeight);
    
    spaceship.style.transform = `translateY(-${heightPercent}%)`;
    
    // Add trail effect
    this.addSpaceshipTrail();
  }

  /**
   * Add spaceship trail effect
   */
  addSpaceshipTrail() {
    const spaceship = this.spaceshipContainer.querySelector('.spaceship');
    if (!spaceship) return;

    const trail = document.createElement('div');
    trail.className = 'spaceship-trail';
    trail.textContent = '✨';
    trail.style.position = 'absolute';
    trail.style.left = spaceship.style.left;
    trail.style.top = spaceship.style.top;
    trail.style.opacity = '0.7';
    trail.style.animation = 'fadeOut 0.5s ease-out forwards';
    
    this.spaceshipContainer.appendChild(trail);

    // Clean up trail after animation
    setTimeout(() => trail.remove(), 500);
  }

  /**
   * Reset spaceship to starting position
   */
  resetSpaceship() {
    const spaceship = this.spaceshipContainer.querySelector('.spaceship');
    if (!spaceship) return;

    spaceship.style.transform = 'translateY(0)';
  }

  /**
   * Play shake animation
   */
  playShakeAnimation() {
    this.gameContainer.classList.add('shake');
    setTimeout(() => {
      this.gameContainer.classList.remove('shake');
    }, 500);
  }

  /**
   * Play win animation
   */
  playWinAnimation() {
    this.balanceDisplay.classList.add('win-pulse');
    setTimeout(() => {
      this.balanceDisplay.classList.remove('win-pulse');
    }, 1000);
  }

  /**
   * Add message to social feed
   */
  addToFeed(message, type) {
    const feedItem = document.createElement('div');
    feedItem.className = `feed-item feed-${type}`;
    feedItem.textContent = message;
    feedItem.style.animation = 'slideIn 0.3s ease-out';

    // Color code based on type
    if (type === 'bet') {
      feedItem.style.borderLeft = '4px solid #3b82f6'; // blue
    } else if (type === 'cashout') {
      feedItem.style.borderLeft = '4px solid #10b981'; // green
    }

    this.socialFeed.insertBefore(feedItem, this.socialFeed.firstChild);
    this.feedItems.push(feedItem);

    // Remove oldest items if exceeding max
    if (this.feedItems.length > this.maxFeedItems) {
      const removed = this.feedItems.shift();
      removed.remove();
    }
  }

  /**
   * Update balance display with animation
   */
  updateBalanceDisplay(newBalance) {
    const currentBalance = parseFloat(this.balanceDisplay.textContent) || this.state.balance;
    const difference = newBalance - currentBalance;

    // Animate the change
    const duration = 500; // milliseconds
    const steps = 30;
    const stepDuration = duration / steps;
    const stepAmount = difference / steps;

    let currentStep = 0;

    const animateBalance = () => {
      currentStep++;
      const animatedBalance = currentBalance + (stepAmount * currentStep);
      this.balanceDisplay.textContent = animatedBalance.toFixed(2);

      if (currentStep < steps) {
        setTimeout(animateBalance, stepDuration);
      } else {
        this.balanceDisplay.textContent = newBalance.toFixed(2);
      }
    };

    animateBalance();
  }

  /**
   * Start countdown timer
   */
  startCountdown(seconds) {
    let remaining = seconds;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.countdownTimer.textContent = remaining;
    this.countdownTimer.style.display = 'block';

    this.countdownInterval = setInterval(() => {
      remaining--;
      this.countdownTimer.textContent = remaining;

      if (remaining <= 0) {
        clearInterval(this.countdownInterval);
        this.countdownTimer.style.display = 'none';
      }
    }, 1000);
  }

  /**
   * Populate history sidebar with round data
   */
  populateHistory(history) {
    this.historyContainer.innerHTML = '';

    history.slice(0, 10).forEach((round) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      historyItem.innerHTML = `
        <div class="history-multiplier">${round.crashPoint.toFixed(2)}x</div>
        <div class="history-time">${new Date(round.timestamp).toLocaleTimeString()}</div>
      `;
      this.historyContainer.appendChild(historyItem);
    });
  }

  /**
   * Reset for new round
   */
  resetForNewRound() {
    this.state.isBetting = false;
    this.state.hasCashedOut = false;
    this.state.currentBet = null;

    this.betAmountInput.disabled = false;
    this.autoCashoutInput.disabled = false;
    this.betAmountInput.value = '';
    this.autoCashoutInput.value = '';
    this.betAmountInput.classList.remove('error');
    this.autoCashoutInput.classList.remove('error');

    this.placeBetButton.disabled = false;
    this.placeBetButton.textContent = 'Place Bet';
    this.placeBetButton.classList.remove('cashout-mode', 'pulse');

    this.multiplierDisplay.textContent = '1.00x';
    this.resetSpaceship();
    this.gameStatusMessage.textContent = 'Waiting for next round...';
    this.gameStatusMessage.classList.remove('flying', 'crashed', 'betting', 'error');
  }
}

// Initialize the client when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const gameClient = new OrbitRushClient();
  gameClient.init();
});
