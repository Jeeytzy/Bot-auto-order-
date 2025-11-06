const axios = require('axios');
const BaseProvider = require('./base-provider');

class SMSPVAProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                params: { apikey: this.apiKey }
            });

            if (response.data && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.map(country => ({
                        id: country.id,
                        name: country.name,
                        country_code: country.code
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
                    apikey: this.apiKey,
                    country: country
                }
            });

            if (response.data && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.filter(s => s.count > 0).map(service => ({
                        id: service.id,
                        name: service.name,
                        price: service.price,
                        stock: service.count,
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
            const response = await axios.post(`${this.baseUrl}/get-number`, {
                apikey: this.apiKey,
                service: serviceId,
                country: country
            });

            if (response.data && response.data.success) {
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

            return { success: false, error: response.data?.error || 'Failed to get number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/get-sms`, {
                params: {
                    apikey: this.apiKey,
                    id: orderId
                }
            });

            if (response.data && response.data.sms) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.sms
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
                apikey: this.apiKey,
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
                apikey: this.apiKey,
                id: orderId
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = SMSPVAProvider;