// Base class untuk semua provider
class BaseProvider {
    constructor(config) {
        this.config = config;
        this.name = config.name;
        this.apiKey = config.api_key || config.account_sid || config.auth_id;
        this.baseUrl = config.base_url;
        this.type = config.type;
        this.emoji = config.emoji;
    }

    // Method yang harus diimplementasikan oleh setiap provider
    async getCountries() {
        throw new Error(`${this.name}: getCountries() not implemented`);
    }

    async getServices(country) {
        throw new Error(`${this.name}: getServices() not implemented`);
    }

    async orderNumber(serviceId, country) {
        throw new Error(`${this.name}: orderNumber() not implemented`);
    }

    async getStatus(orderId) {
        throw new Error(`${this.name}: getStatus() not implemented`);
    }

    async cancelOrder(orderId) {
        throw new Error(`${this.name}: cancelOrder() not implemented`);
    }

    async setStatus(orderId, status) {
        throw new Error(`${this.name}: setStatus() not implemented`);
    }

    // Helper method untuk format harga
    formatPrice(price, markup = 0) {
        return parseInt(price) + markup;
    }

    // Helper method untuk error handling
    handleError(error, operation) {
        console.error(`[${this.name}] Error in ${operation}:`, error.message);
        return {
            success: false,
            error: error.message,
            provider: this.name
        };
    }
}

module.exports = BaseProvider;