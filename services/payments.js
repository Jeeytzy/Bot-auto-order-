const axios = require('axios');
const logger = require('./logger');

class PaymentService {
    constructor() {
        this.config = null;
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
    }

    setConfig(config) {
        this.config = config;
        
        // Configure axios with better error handling
        axios.defaults.timeout = 10000;
        axios.interceptors.response.use(
            response => response,
            error => {
                logger.error('Payment API error', error, {
                    url: error.config?.url,
                    method: error.config?.method
                });
                return Promise.reject(error);
            }
        );
    }

    async createQRISDeposit(nominal, userId) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const params = new URLSearchParams({
                    nominal: nominal.toString(),
                    metode: 'QRISFAST'
                });

                const res = await axios.get(`${this.config.CIAATOPUP_CREATE_URL}?${params}`, {
                    headers: { 
                        'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                if (!res.data || res.data.success !== true || !res.data.data || !res.data.data.qr_string) {
                    if (attempt === this.maxRetries) {
                        logger.error('QRIS creation failed after retries', null, {
                            userId,
                            nominal,
                            response: res.data
                        });
                        return {
                            success: false,
                            error: 'Gagal membuat QRIS payment. Silakan coba lagi atau gunakan metode manual.'
                        };
                    }
                    
                    // Retry with delay
                    await this.delay(this.retryDelay * attempt);
                    continue;
                }

                logger.info('QRIS deposit created', {
                    userId,
                    nominal,
                    trxId: res.data.data.id
                });

                return {
                    success: true,
                    data: res.data.data
                };

            } catch (error) {
                logger.error(`QRIS creation attempt ${attempt} failed`, error, {
                    userId,
                    nominal
                });

                if (attempt === this.maxRetries) {
                    return {
                        success: false,
                        error: 'Gagal menghubungi payment gateway. Silakan coba lagi nanti atau gunakan metode manual.'
                    };
                }

                await this.delay(this.retryDelay * attempt);
            }
        }
    }

    async checkDepositStatus(trxId) {
        try {
            const params = new URLSearchParams({
                id: trxId
            });

            const res = await axios.get(`${this.config.CIAATOPUP_STATUS_URL}?${params}`, {
                headers: { 
                    'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            if (res.data && res.data.data) {
                return {
                    success: true,
                    status: res.data.data.status,
                    data: res.data.data
                };
            }

            return {
                success: false,
                status: 'unknown'
            };

        } catch (error) {
            logger.error('Deposit status check failed', error, { trxId });
            return {
                success: false,
                status: 'error',
                error: error.message
            };
        }
    }

    async cancelDeposit(trxId) {
        try {
            const params = new URLSearchParams({
                id: trxId
            });

            const res = await axios.get(`${this.config.CIAATOPUP_CANCEL_URL}?${params}`, {
                headers: { 
                    'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            logger.info('Deposit cancelled', { trxId });

            return {
                success: res.data && res.data.success === true
            };

        } catch (error) {
            logger.error('Deposit cancellation failed', error, { trxId });
            
            // Even if API fails, we mark it as locally cancelled
            return {
                success: false,
                localCancelled: true
            };
        }
    }

    async getManualPaymentOptions() {
        const options = [];
        const config = this.config.MANUAL_PAYMENT;

        if (config.QRIS && config.QRIS.enabled) {
            options.push({
                type: 'QRIS',
                name: config.QRIS.name,
                image: config.QRIS.image_url,
                icon: '📱'
            });
        }

        if (config.DANA && config.DANA.enabled) {
            options.push({
                type: 'DANA',
                name: config.DANA.name,
                number: config.DANA.number,
                icon: '💳'
            });
        }

        if (config.OVO && config.OVO.enabled) {
            options.push({
                type: 'OVO',
                name: config.OVO.name,
                number: config.OVO.number,
                icon: '💳'
            });
        }

        if (config.GOPAY && config.GOPAY.enabled) {
            options.push({
                type: 'GOPAY',
                name: config.GOPAY.name,
                number: config.GOPAY.number,
                icon: '💳'
            });
        }

        if (config.BCA && config.BCA.enabled) {
            options.push({
                type: 'BCA',
                name: config.BCA.account_name,
                number: config.BCA.account_number,
                icon: '🏦'
            });
        }

        return options;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new PaymentService();
