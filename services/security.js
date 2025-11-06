const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const Bottleneck = require('bottleneck');

class SecurityService {
    constructor() {
        this.blacklistFile = path.join('data', 'blacklist.json');
        this.rateLimitFile = path.join('data', 'ratelimit.json');
        this.blacklist = new Set();
        this.rateLimiters = new Map();
        
        // Rate limiter config per user
        this.userLimiter = new Bottleneck({
            minTime: 1000, // 1 detik antara request
            maxConcurrent: 1
        });
        
        // Command rate limiters
        this.commandLimiters = new Map();
        
        this.init();
    }

    async init() {
        try {
            // Load blacklist
            try {
                const blacklistData = await fs.readFile(this.blacklistFile, 'utf8');
                const list = JSON.parse(blacklistData);
                this.blacklist = new Set(list);
                logger.info('Blacklist loaded', { count: this.blacklist.size });
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.error('Failed to load blacklist', error);
                }
                await this.saveBlacklist();
            }
        } catch (error) {
            logger.error('Security service initialization error', error);
        }
    }

    async saveBlacklist() {
        try {
            const list = Array.from(this.blacklist);
            await fs.writeFile(this.blacklistFile, JSON.stringify(list, null, 2));
        } catch (error) {
            logger.error('Failed to save blacklist', error);
        }
    }

    async addToBlacklist(userId, reason = '') {
        this.blacklist.add(userId.toString());
        await this.saveBlacklist();
        logger.logSecurityEvent('user_blacklisted', userId, { reason });
    }

    async removeFromBlacklist(userId) {
        this.blacklist.delete(userId.toString());
        await this.saveBlacklist();
        logger.logSecurityEvent('user_unblacklisted', userId);
    }

    isBlacklisted(userId) {
        return this.blacklist.has(userId.toString());
    }

    getUserRateLimiter(userId) {
        const key = userId.toString();
        if (!this.rateLimiters.has(key)) {
            this.rateLimiters.set(key, new Bottleneck({
                minTime: 500, // 500ms antara command
                maxConcurrent: 1,
                reservoir: 10, // Max 10 command
                reservoirRefreshAmount: 10,
                reservoirRefreshInterval: 60 * 1000 // Reset tiap 1 menit
            }));
        }
        return this.rateLimiters.get(key);
    }

    async checkRateLimit(userId, command) {
        const limiter = this.getUserRateLimiter(userId);
        
        try {
            await limiter.schedule(() => Promise.resolve());
            return { allowed: true };
        } catch (error) {
            logger.logSecurityEvent('rate_limit_exceeded', userId, { command });
            return { 
                allowed: false, 
                message: '⚠️ Terlalu banyak request. Tunggu sebentar dan coba lagi.' 
            };
        }
    }

    async validateAccess(userId, command, requiredRole = null) {
        // Check blacklist
        if (this.isBlacklisted(userId)) {
            logger.logSecurityEvent('blacklisted_access_attempt', userId, { command });
            return {
                allowed: false,
                message: '🚫 Akses ditolak. Hubungi admin jika ada kesalahan.'
            };
        }

        // Check rate limit
        const rateCheck = await this.checkRateLimit(userId, command);
        if (!rateCheck.allowed) {
            return rateCheck;
        }

        return { allowed: true };
    }

    sanitizeUserId(userId) {
        // Hide sebagian user ID untuk privacy
        const id = userId.toString();
        if (id.length <= 6) return 'xxx' + id.slice(-3);
        return id.substring(0, 4) + 'xxx' + id.substring(id.length - 3);
    }

    sanitizeUsername(username) {
        if (!username) return 'User';
        // Hide sebagian username
        if (username.length <= 4) return username[0] + '***';
        return username.substring(0, 2) + '***' + username.slice(-1);
    }
}

module.exports = new SecurityService();
