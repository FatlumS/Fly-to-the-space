/**
 * MockRedis - A lightweight Redis client mock for testing
 * Implements a subset of ioredis commands for unit and integration testing
 * 
 * Usage:
 *   const redis = new MockRedis();
 *   await redis.set('key', 'value');
 *   const value = await redis.get('key');
 */

class MockRedis {
  constructor() {
    /**
     * Internal storage map
     * Structure: key -> { type, value }
     * Types: 'string', 'hash', 'set', 'zset'
     */
    this.store = new Map();
  }

  /**
   * Hash Operations
   */

  /**
   * Store an object as a hash
   * @param {string} key - The key name
   * @param {Object} data - Object to store
   * @returns {Promise<string>} 'OK'
   */
  async hset(key, data) {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Data must be an object');
    }

    this.store.set(key, {
      type: 'hash',
      value: new Map(Object.entries(data))
    });

    return 'OK';
  }

  /**
   * Retrieve a hash as an object
   * @param {string} key - The key name
   * @returns {Promise<Object|null>} The stored object or null if not found
   */
  async hgetall(key) {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (entry.type !== 'hash') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    const result = {};
    for (const [k, v] of entry.value.entries()) {
      result[k] = v;
    }
    return result;
  }

  /**
   * Increment a numeric field in a hash
   * @param {string} key - The hash key
   * @param {string} field - The field name
   * @param {number} increment - Amount to increment by
   * @returns {Promise<number>} The new value
   */
  async hincrby(key, field, increment) {
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        type: 'hash',
        value: new Map()
      };
      this.store.set(key, entry);
    }

    if (entry.type !== 'hash') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    const current = parseInt(entry.value.get(field) || '0');
    const newValue = current + increment;
    entry.value.set(field, newValue.toString());

    return newValue;
  }

  /**
   * Set Operations
   */

  /**
   * Add a value to a set
   * @param {string} key - The set key
   * @param {string|number} value - Value to add
   * @returns {Promise<number>} Number of elements added (0 if already existed, 1 if new)
   */
  async sadd(key, value) {
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        type: 'set',
        value: new Set()
      };
      this.store.set(key, entry);
    }

    if (entry.type !== 'set') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    const hadValue = entry.value.has(value);
    entry.value.add(value);

    return hadValue ? 0 : 1;
  }

  /**
   * Get all members of a set
   * @param {string} key - The set key
   * @returns {Promise<Array>} Array of set members, or empty array if not found
   */
  async smembers(key) {
    const entry = this.store.get(key);

    if (!entry) {
      return [];
    }

    if (entry.type !== 'set') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    return Array.from(entry.value);
  }

  /**
   * Sorted Set Operations
   */

  /**
   * Add a member to a sorted set with a score
   * @param {string} key - The sorted set key
   * @param {number} score - Score for sorting
   * @param {string|number} value - Member value
   * @returns {Promise<number>} Number of elements added (0 if updated, 1 if new)
   */
  async zadd(key, score, value) {
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        type: 'zset',
        value: new Map() // Map<value, score>
      };
      this.store.set(key, entry);
    }

    if (entry.type !== 'zset') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    const hadValue = entry.value.has(value);
    entry.value.set(value, score);

    return hadValue ? 0 : 1;
  }

  /**
   * Get a range from a sorted set in reverse order (highest scores first)
   * @param {string} key - The sorted set key
   * @param {number} start - Start index (0-based)
   * @param {number} stop - Stop index (inclusive, -1 means end)
   * @returns {Promise<Array>} Array of members in reverse score order
   */
  async zrevrange(key, start, stop) {
    const entry = this.store.get(key);

    if (!entry) {
      return [];
    }

    if (entry.type !== 'zset') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    // Convert Map to array of [value, score] pairs
    const pairs = Array.from(entry.value.entries()).map(([value, score]) => ({
      value,
      score
    }));

    // Sort by score descending (reverse order)
    pairs.sort((a, b) => b.score - a.score);

    // Apply range
    const end = stop === -1 ? pairs.length : stop + 1;
    const range = pairs.slice(start, end);

    // Return just the values
    return range.map(item => item.value);
  }

  /**
   * String Operations
   */

  /**
   * Set a string value
   * @param {string} key - The key
   * @param {string|number} value - Value to store
   * @returns {Promise<string>} 'OK'
   */
  async set(key, value) {
    this.store.set(key, {
      type: 'string',
      value: String(value)
    });
    return 'OK';
  }

  /**
   * Get a string value
   * @param {string} key - The key
   * @returns {Promise<string|null>} The stored value or null if not found
   */
  async get(key) {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    if (entry.type !== 'string') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    return entry.value;
  }

  /**
   * Set a string value with expiration (expiry ignored in mock)
   * @param {string} key - The key
   * @param {number} seconds - Expiration time in seconds (ignored)
   * @param {string|number} value - Value to store
   * @returns {Promise<string>} 'OK'
   */
  async setex(key, seconds, value) {
    // In mock implementation, we ignore the expiration
    // In production, you'd set a TTL and remove on access
    this.store.set(key, {
      type: 'string',
      value: String(value),
      expiry: Date.now() + seconds * 1000 // Store for reference if needed
    });
    return 'OK';
  }

  /**
   * General Key Operations
   */

  /**
   * Delete a key
   * @param {string} key - The key to delete
   * @returns {Promise<number>} 1 if deleted, 0 if not found
   */
  async del(key) {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  /**
   * Set expiration (no-op for tests)
   * @param {string} key - The key
   * @param {number} seconds - Expiration time in seconds
   * @returns {Promise<number>} 1 if timeout was set, 0 if key doesn't exist
   */
  async expire(key, seconds) {
    // No-op for testing purposes
    // In production, you'd update the TTL
    const existed = this.store.has(key);
    return existed ? 1 : 0;
  }

  /**
   * Get all keys matching a pattern
   * Supports simple * wildcard only (not full glob)
   * @param {string} pattern - Pattern to match (e.g., 'user:*')
   * @returns {Promise<Array>} Array of matching keys
   */
  async keys(pattern) {
    const keys = Array.from(this.store.keys());

    if (pattern === '*') {
      return keys;
    }

    // Simple pattern matching: convert glob to regex
    // e.g., 'user:*' -> /^user:/
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);

    return keys.filter(key => regex.test(key));
  }

  /**
   * Utility Methods
   */

  /**
   * Clear all data from the mock
   */
  async flushAll() {
    this.store.clear();
    return 'OK';
  }

  /**
   * Get the number of keys in the store
   * @returns {Promise<number>} Number of keys
   */
  async dbsize() {
    return this.store.size;
  }

  /**
   * Check if a key exists
   * @param {string} key - The key
   * @returns {Promise<number>} 1 if exists, 0 if not
   */
  async exists(key) {
    return this.store.has(key) ? 1 : 0;
  }

  /**
   * Get the type of a key
   * @param {string} key - The key
   * @returns {Promise<string>} Type: 'string', 'hash', 'set', 'zset', or 'none'
   */
  async type(key) {
    const entry = this.store.get(key);
    return entry ? entry.type : 'none';
  }

  /**
   * Array/List Operations (basic implementation for compatibility)
   */

  /**
   * Push value to list (head)
   * @param {string} key - The list key
   * @param {string|number} value - Value to push
   * @returns {Promise<number>} Length of list
   */
  async lpush(key, value) {
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        type: 'list',
        value: []
      };
      this.store.set(key, entry);
    }

    if (entry.type !== 'list') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    entry.value.unshift(value);
    return entry.value.length;
  }

  /**
   * Get range from list
   * @param {string} key - The list key
   * @param {number} start - Start index
   * @param {number} stop - Stop index (-1 for end)
   * @returns {Promise<Array>} Array of list elements
   */
  async lrange(key, start, stop) {
    const entry = this.store.get(key);

    if (!entry) {
      return [];
    }

    if (entry.type !== 'list') {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value`);
    }

    const end = stop === -1 ? entry.value.length : stop + 1;
    return entry.value.slice(start, end);
  }

  /**
   * Increment integer value
   * @param {string} key - The key
   * @param {number} increment - Amount to increment by
   * @returns {Promise<number>} New value
   */
  async incr(key) {
    return this.incrby(key, 1);
  }

  /**
   * Increment integer value by amount
   * @param {string} key - The key
   * @param {number} increment - Amount to increment by
   * @returns {Promise<number>} New value
   */
  async incrby(key, increment) {
    const entry = this.store.get(key);
    const current = entry ? parseInt(entry.value || '0') : 0;
    const newValue = current + increment;

    this.store.set(key, {
      type: 'string',
      value: newValue.toString()
    });

    return newValue;
  }
}

module.exports = MockRedis;
