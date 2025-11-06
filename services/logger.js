const winston = require('winston');
const path = require('path');

const redactFields = ['api_key', 'token', 'password', 'secret', 'apiKey', 'auth_token'];

const redactSensitiveData = winston.format((info) => {
    const redact = (obj) => {
        if (typeof obj !== 'object' || obj === null) return obj;
        
        const redacted = { ...obj };
        for (const key in redacted) {
            if (redactFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
                redacted[key] = '***REDACTED***';
            } else if (typeof redacted[key] === 'object') {
                redacted[key] = redact(redacted[key]);
            }
        }
        return redacted;
    };

    info.message = typeof info.message === 'object' ? redact(info.message) : info.message;
    if (info.meta) {
        info.meta = redact(info.meta);
    }
    
    return info;
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        redactSensitiveData(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'telegram-bot' },
    transports: [
        new winston.transports.File({ 
            filename: path.join('data', 'error.log'), 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({ 
            filename: path.join('data', 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

class Logger {
    info(message, meta = {}) {
        logger.info(message, meta);
    }

    error(message, error = null, meta = {}) {
        if (error instanceof Error) {
            logger.error(message, { 
                error: error.message, 
                stack: error.stack,
                ...meta 
            });
        } else {
            logger.error(message, { error, ...meta });
        }
    }

    warn(message, meta = {}) {
        logger.warn(message, meta);
    }

    debug(message, meta = {}) {
        logger.debug(message, meta);
    }

    logProductAction(action, userId, productId, details = {}) {
        this.info(`Product ${action}`, {
            action,
            userId,
            productId,
            timestamp: new Date().toISOString(),
            ...details
        });
    }

    logOrderAction(action, userId, orderId, details = {}) {
        this.info(`Order ${action}`, {
            action,
            userId,
            orderId,
            timestamp: new Date().toISOString(),
            ...details
        });
    }

    logSecurityEvent(event, userId, details = {}) {
        this.warn(`Security event: ${event}`, {
            event,
            userId,
            timestamp: new Date().toISOString(),
            ...details
        });
    }
}

module.exports = new Logger();
