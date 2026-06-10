/**
 * GameRenderer - Canvas-based game renderer
 * Handles all visual rendering for the Orbit Rush game using HTML5 Canvas API
 */

class GameRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    
    // Canvas dimensions
    this.width = 0;
    this.height = 0;
    
    // Game objects
    this.spaceship = {
      x: 0,
      y: 0,
      width: 20,
      height: 40,
      rotation: 0
    };
    
    // Particle system
    this.particles = [];
    this.stars = [];
    
    // Animation state
    this.shakeAmount = 0;
    this.isCrashing = false;
    this.crashShakeTime = 0;
    this.multiplierScale = 1;
    this.multiplierScaleDirection = 1;
    
    // Game state
    this.gameState = null;
    this.lastMultiplier = 1;
    
    // Animation frame ID
    this.animationFrameId = null;
  }

  /**
   * Initialize the renderer
   */
  init() {
    // Set canvas dimensions
    this.setCanvasDimensions();
    
    // Generate starfield
    this.generateStarfield();
    
    // Position spaceship at bottom center
    this.spaceship.x = this.width / 2;
    this.spaceship.y = this.height - 60;
    
    // Add window resize listener
    window.addEventListener('resize', () => this.setCanvasDimensions());
    
    console.log('GameRenderer initialized - Canvas:', this.width, 'x', this.height);
  }

  /**
   * Set canvas dimensions to match container
   */
  setCanvasDimensions() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width * window.devicePixelRatio;
    this.height = rect.height * window.devicePixelRatio;
    
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    // Scale context for high DPI
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // Recalculate spaceship position
    this.spaceship.x = this.width / (2 * window.devicePixelRatio);
    this.spaceship.y = this.height / window.devicePixelRatio - 60;
  }

  /**
   * Generate random starfield
   */
  generateStarfield() {
    this.stars = [];
    const starCount = 100;
    
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * (this.width / window.devicePixelRatio),
        y: Math.random() * (this.height / window.devicePixelRatio),
        opacity: Math.random() * 0.7 + 0.3,
        twinkleSpeed: Math.random() * 0.05 + 0.01,
        twinklePhase: Math.random() * Math.PI * 2,
        size: Math.random() * 1.5 + 0.5
      });
    }
  }

  /**
   * Draw starfield background with gradient
   */
  drawBackground() {
    const displayWidth = this.width / window.devicePixelRatio;
    const displayHeight = this.height / window.devicePixelRatio;
    
    // Draw gradient background (dark navy to black)
    const gradient = this.ctx.createLinearGradient(0, 0, 0, displayHeight);
    gradient.addColorStop(0, '#0a1428');
    gradient.addColorStop(0.5, '#0d1b2a');
    gradient.addColorStop(1, '#000000');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, displayWidth, displayHeight);
    
    // Draw stars with twinkling effect
    this.stars.forEach((star) => {
      // Update twinkle
      star.twinklePhase += star.twinkleSpeed;
      const twinkleOpacity = Math.sin(star.twinklePhase) * 0.5 + 0.5;
      const finalOpacity = star.opacity * twinkleOpacity;
      
      // Draw star
      this.ctx.fillStyle = `rgba(255, 255, 255, ${finalOpacity})`;
      this.ctx.beginPath();
      this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  /**
   * Draw spaceship at current position
   */
  drawSpaceship(multiplier) {
    const displayWidth = this.width / window.devicePixelRatio;
    const displayHeight = this.height / window.devicePixelRatio;
    
    // Calculate ship position based on multiplier
    // 1x = near bottom, 100x = near top
    const maxHeight = displayHeight - 100;
    const minHeight = 50;
    const normalizedMultiplier = Math.min((multiplier - 1) / 99, 1);
    const shipY = maxHeight - (normalizedMultiplier * (maxHeight - minHeight));
    
    this.spaceship.y = shipY;
    
    // Scale spaceship slightly based on multiplier
    const baseScale = 1 + (normalizedMultiplier * 0.5);
    
    // Draw exhaust flames (bigger as multiplier increases)
    this.drawExhaustFlame(this.spaceship.x, this.spaceship.y, multiplier, baseScale);
    
    // Save context
    this.ctx.save();
    this.ctx.translate(this.spaceship.x, this.spaceship.y);
    
    // Draw spaceship (triangle/rocket shape)
    this.ctx.fillStyle = '#00ff88';
    this.ctx.strokeStyle = '#00ff88';
    this.ctx.lineWidth = 2;
    
    // Draw rocket body
    const shipWidth = this.spaceship.width * baseScale;
    const shipHeight = this.spaceship.height * baseScale;
    
    // Main body (triangle pointing up)
    this.ctx.beginPath();
    this.ctx.moveTo(0, -shipHeight / 2);
    this.ctx.lineTo(-shipWidth / 2, shipHeight / 2);
    this.ctx.lineTo(shipWidth / 2, shipHeight / 2);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    
    // Cockpit window
    this.ctx.fillStyle = '#00ffff';
    this.ctx.beginPath();
    this.ctx.arc(0, -shipHeight / 4, shipWidth / 6, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Wings/stabilizers
    this.ctx.strokeStyle = '#00ff88';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(-shipWidth / 2.5, shipHeight / 3);
    this.ctx.lineTo(-shipWidth / 2, shipHeight / 2);
    this.ctx.moveTo(shipWidth / 2.5, shipHeight / 3);
    this.ctx.lineTo(shipWidth / 2, shipHeight / 2);
    this.ctx.stroke();
    
    this.ctx.restore();
    
    // Glow effect
    this.ctx.shadowColor = '#00ff88';
    this.ctx.shadowBlur = 20;
  }

  /**
   * Draw exhaust flame effect
   */
  drawExhaustFlame(x, y, multiplier, scale) {
    const flameHeight = 30 * scale + (multiplier * 5);
    const flameWidth = 15 * scale + (multiplier * 2);
    
    // Flame gradient
    const flameGradient = this.ctx.createLinearGradient(
      x, y + this.spaceship.height * scale / 2,
      x, y + this.spaceship.height * scale / 2 + flameHeight
    );
    flameGradient.addColorStop(0, 'rgba(255, 165, 0, 0.8)');
    flameGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.5)');
    flameGradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
    
    this.ctx.fillStyle = flameGradient;
    
    // Draw flame as triangle
    this.ctx.beginPath();
    this.ctx.moveTo(x - flameWidth / 2, y + this.spaceship.height * scale / 2);
    this.ctx.lineTo(x + flameWidth / 2, y + this.spaceship.height * scale / 2);
    this.ctx.lineTo(x, y + this.spaceship.height * scale / 2 + flameHeight);
    this.ctx.closePath();
    this.ctx.fill();
    
    // Spawn exhaust particles
    if (Math.random() > 0.6) {
      const particleCount = Math.ceil(multiplier / 2);
      this.spawnParticles(x, y + this.spaceship.height * scale / 2, particleCount);
    }
  }

  /**
   * Spawn particles at position
   */
  spawnParticles(x, y, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 1;
      
      this.particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        lifetime: 1,
        maxLifetime: 1 + Math.random() * 0.5,
        color: `hsl(${30 + Math.random() * 30}, 100%, ${50 + Math.random() * 30}%)`,
        size: Math.random() * 2 + 1
      });
    }
  }

  /**
   * Update particle positions and lifetimes
   */
  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Update position
      p.x += p.vx;
      p.y += p.vy;
      
      // Apply gravity
      p.vy += 0.1;
      
      // Reduce lifetime
      p.lifetime -= 0.02;
      
      // Remove dead particles
      if (p.lifetime <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Draw all particles
   */
  drawParticles() {
    this.particles.forEach((p) => {
      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = p.lifetime / p.maxLifetime;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    });
  }

  /**
   * Crash animation sequence
   */
  crashAnimation() {
    this.isCrashing = true;
    this.crashShakeTime = 30;
    
    // Flash the screen white
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.fillRect(0, 0, this.width / window.devicePixelRatio, this.height / window.devicePixelRatio);
    
    // Spawn explosion particles from ship
    this.spawnParticles(this.spaceship.x, this.spaceship.y, 30);
  }

  /**
   * Update crash animation
   */
  updateCrashAnimation() {
    if (this.isCrashing) {
      this.crashShakeTime--;
      
      if (this.crashShakeTime <= 0) {
        this.isCrashing = false;
        this.shakeAmount = 0;
      } else {
        // Shake effect
        this.shakeAmount = (Math.random() - 0.5) * 20;
      }
    }
  }

  /**
   * Draw multiplier text
   */
  drawMultiplierText(multiplier) {
    const displayWidth = this.width / window.devicePixelRatio;
    const displayHeight = this.height / window.devicePixelRatio;
    
    // Update pulsing scale
    this.multiplierScale += this.multiplierScaleDirection * 0.02;
    if (this.multiplierScale >= 1.2) this.multiplierScaleDirection = -1;
    if (this.multiplierScale <= 0.9) this.multiplierScaleDirection = 1;
    
    // Determine color based on multiplier
    let textColor = '#ffffff'; // white (1-2x)
    if (multiplier >= 10) {
      textColor = '#ff0000'; // red (10x+)
    } else if (multiplier >= 2) {
      textColor = '#ffa500'; // orange (2-10x)
    }
    
    // Save context
    this.ctx.save();
    
    // Center and scale
    this.ctx.translate(displayWidth / 2, displayHeight / 3);
    this.ctx.scale(this.multiplierScale, this.multiplierScale);
    
    // Draw text shadow (glow)
    this.ctx.fillStyle = textColor;
    this.ctx.globalAlpha = 0.3;
    this.ctx.shadowColor = textColor;
    this.ctx.shadowBlur = 30;
    this.ctx.font = 'bold 120px Arial, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(multiplier.toFixed(2) + 'x', 0, 0);
    
    // Draw main text
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = textColor;
    this.ctx.shadowBlur = 50;
    this.ctx.fillText(multiplier.toFixed(2) + 'x', 0, 0);
    
    this.ctx.restore();
  }

  /**
   * Draw game-over/crash message
   */
  drawCrashMessage(crashPoint) {
    const displayWidth = this.width / window.devicePixelRatio;
    const displayHeight = this.height / window.devicePixelRatio;
    
    // Semi-transparent overlay
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.fillRect(0, 0, displayWidth, displayHeight);
    
    // Crash message
    this.ctx.fillStyle = '#ff0000';
    this.ctx.shadowColor = '#ff0000';
    this.ctx.shadowBlur = 20;
    this.ctx.font = 'bold 60px Arial, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`CRASHED at ${crashPoint.toFixed(2)}x!`, displayWidth / 2, displayHeight / 2);
  }

  /**
   * Reset renderer state
   */
  reset() {
    // Clear particles
    this.particles = [];
    
    // Reset ship position
    const displayHeight = this.height / window.devicePixelRatio;
    this.spaceship.y = displayHeight - 60;
    
    // Reset animation states
    this.shakeAmount = 0;
    this.isCrashing = false;
    this.crashShakeTime = 0;
    this.multiplierScale = 1;
    
    // Redraw clean background
    this.drawBackground();
  }

  /**
   * Main render loop
   */
  render(multiplier, gameState) {
    const displayWidth = this.width / window.devicePixelRatio;
    const displayHeight = this.height / window.devicePixelRatio;
    
    // Apply shake effect
    this.ctx.save();
    if (this.shakeAmount !== 0) {
      this.ctx.translate(this.shakeAmount, 0);
    }
    
    // Clear canvas
    this.ctx.clearRect(0, 0, displayWidth, displayHeight);
    
    // Draw background
    this.drawBackground();
    
    // Update and draw particles
    this.updateParticles();
    this.drawParticles();
    
    // Update crash animation
    this.updateCrashAnimation();
    
    // Draw spaceship
    this.drawSpaceship(multiplier);
    
    // Draw multiplier text
    this.drawMultiplierText(multiplier);
    
    // Draw crash message if crashed
    if (gameState && gameState.isCrashed) {
      this.drawCrashMessage(gameState.crashPoint);
    }
    
    this.ctx.restore();
    
    // Request next frame
    this.animationFrameId = requestAnimationFrame(() => {
      this.render(multiplier, gameState);
    });
  }

  /**
   * Start rendering
   */
  start(multiplier = 1, gameState = null) {
    this.gameState = gameState;
    this.render(multiplier, gameState);
  }

  /**
   * Stop rendering
   */
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Trigger crash animation
   */
  crash(crashPoint) {
    this.gameState = { isCrashed: true, crashPoint };
    this.crashAnimation();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameRenderer;
}
