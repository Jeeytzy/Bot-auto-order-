const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

class ValidationService {
    constructor() {
        this.productSchema = {
            type: 'object',
            properties: {
                id: { type: 'string', pattern: '^PROD-\\d+$' },
                name: { type: 'string', minLength: 1, maxLength: 200 },
                description: { type: 'string', minLength: 1, maxLength: 5000 },
                price: { type: 'number', minimum: 100 },
                stock: { type: 'integer', minimum: 0 },
                paymentMethod: { type: 'string', enum: ['auto', 'manual', 'both'] },
                productData: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['text', 'file', 'link', 'telegram_file'] },
                        content: { type: 'string' },
                        fileId: { type: 'string' },
                        fileName: { type: 'string' }
                    },
                    required: ['type']
                },
                image: {
                    type: 'object',
                    properties: {
                        fileId: { type: 'string' },
                        url: { type: 'string' }
                    }
                },
                createdAt: { type: 'string' },
                createdBy: { type: 'string' }
            },
            required: ['id', 'name', 'description', 'price', 'stock', 'paymentMethod', 'productData']
        };

        this.productOrderSchema = {
            type: 'object',
            properties: {
                orderId: { type: 'string', pattern: '^ORDER-\\d+$' },
                userId: { type: 'string' },
                username: { type: 'string' },
                fullName: { type: 'string' },
                productId: { type: 'string' },
                productName: { type: 'string' },
                price: { type: 'number', minimum: 0 },
                status: { type: 'string', enum: ['pending', 'approved', 'completed', 'rejected', 'cancelled'] },
                paymentMethod: { type: 'string' },
                createdAt: { type: 'string' },
                timeInfo: { type: 'object' }
            },
            required: ['orderId', 'userId', 'productId', 'productName', 'price', 'status']
        };

        this.validateProduct = ajv.compile(this.productSchema);
        this.validateProductOrder = ajv.compile(this.productOrderSchema);
    }

    sanitizeString(str, maxLength = 1000) {
        if (typeof str !== 'string') return '';
        
        // Remove dangerous characters and limit length
        let sanitized = str
            .replace(/[<>]/g, '') // Remove HTML tags
            .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
            .trim();
        
        return sanitized.substring(0, maxLength);
    }

    sanitizeNumber(num, min = 0, max = Number.MAX_SAFE_INTEGER) {
        const parsed = parseInt(num);
        if (isNaN(parsed)) return min;
        return Math.max(min, Math.min(max, parsed));
    }

    isValidProductName(name) {
        if (typeof name !== 'string') return false;
        if (name.length < 1 || name.length > 200) return false;
        // Hanya karakter yang aman
        return /^[a-zA-Z0-9\s\-_.,!?()&]+$/.test(name);
    }

    isValidPrice(price) {
        const parsed = parseInt(price);
        return !isNaN(parsed) && parsed >= 100 && parsed <= 1000000000;
    }

    isValidStock(stock) {
        const parsed = parseInt(stock);
        return !isNaN(parsed) && parsed >= 0 && parsed <= 999999;
    }

    validateProductData(product) {
        const isValid = this.validateProduct(product);
        if (!isValid) {
            return {
                valid: false,
                errors: this.validateProduct.errors
            };
        }
        return { valid: true };
    }

    validateProductOrderData(order) {
        const isValid = this.validateProductOrder(order);
        if (!isValid) {
            return {
                valid: false,
                errors: this.validateProductOrder.errors
            };
        }
        return { valid: true };
    }

    sanitizeProductInput(input) {
        return {
            name: this.sanitizeString(input.name, 200),
            description: this.sanitizeString(input.description, 5000),
            price: this.sanitizeNumber(input.price, 100, 1000000000),
            stock: this.sanitizeNumber(input.stock, 0, 999999)
        };
    }
}

module.exports = new ValidationService();
