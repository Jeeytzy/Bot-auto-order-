const axios = require('axios');
const BaseProvider = require('./base-provider');

class ReceiveSMSProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                params: { api_key: this.apiKey }
            });

            if (response.data && response.data.countries) {
                return {
                    success: true,
                    data: response.data.countries.map(c => ({
                        id: c.id,
                        name: c.name,
                        country_code: c.code
                    }))
                };
            }

            return { success: false, error: 'No countries data' };
        } catch (error) {
            return this.handleError(error, 'getCountries');
        }
    }

    async getServices(country) {
        try {
            const response = await axios.get(`${this.baseUrl}/services`, {
                params: {
                    api_key: this.apiKey,
                    country: country
                }
            });

            if (response.data && response.data.services) {
                return {
                    success: true,
                    data: response.data.services.filter(s => s.qty > 0).map(service => ({
                        id: service.id,
                        name: service.name,
                        price: service.price,
                        stock: service.qty,
                        country: country
                    }))
                };
            }

            return { success: false, error: 'No services available' };
        } catch (error) {
            return this.handleError(error, 'getServices');
        }
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.post(`${this.baseUrl}/buy`, {
                api_key: this.apiKey,
                service: serviceId,
                country: country
            });

            if (response.data && response.data.number) {
                return {
                    success: true,
                    data: {
                        id: response.data.id.toString(),
                        number: response.data.number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.message || 'Failed to buy number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/check`, {
                params: {
                    api_key: this.apiKey,
                    id: orderId
                }
            });

            if (response.data && response.data.code) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.code
                    }
                };
            }

            if (response.data && response.data.status === 'wait') {
                return {
                    success: true,
                    data: { status: 'Waiting' }
                };
            }

            return { success: false, error: 'SMS not received' };
        } catch (error) {
            return this.handleError(error, 'getStatus');
        }
    }

    async cancelOrder(orderId) {
        try {
            const response = await axios.post(`${this.baseUrl}/cancel`, {
                api_key: this.apiKey,
                id: orderId
            });

            return {
                success: response.data?.success === true,
                message: 'Order cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            const action = status === '2' ? 'cancel' : 'finish';
            const response = await axios.post(`${this.baseUrl}/${action}`, {
                api_key: this.apiKey,
                id: orderId
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = ReceiveSMSProvider;