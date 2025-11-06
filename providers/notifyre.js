const axios = require('axios');
const BaseProvider = require('./base-provider');

class NotifyreProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                headers: { 'X-API-Key': this.apiKey }
            });

            if (response.data && response.data.countries) {
                return {
                    success: true,
                    data: response.data.countries.map(c => ({
                        id: c.code,
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
                params: { country: country },
                headers: { 'X-API-Key': this.apiKey }
            });

            if (response.data && response.data.services) {
                return {
                    success: true,
                    data: response.data.services.filter(s => s.available > 0).map(service => ({
                        id: service.id,
                        name: service.name,
                        price: service.price,
                        stock: service.available,
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
            const response = await axios.post(`${this.baseUrl}/purchase`, {
                service: serviceId,
                country: country
            }, {
                headers: { 'X-API-Key': this.apiKey }
            });

            if (response.data && response.data.success) {
                return {
                    success: true,
                    data: {
                        id: response.data.order_id.toString(),
                        number: response.data.phone,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.error || 'Failed to purchase' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/status/${orderId}`, {
                headers: { 'X-API-Key': this.apiKey }
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

            if (response.data && response.data.status === 'pending') {
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
            const response = await axios.post(`${this.baseUrl}/cancel/${orderId}`, {}, {
                headers: { 'X-API-Key': this.apiKey }
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
            const action = status === '2' ? 'cancel' : 'complete';
            const response = await axios.post(`${this.baseUrl}/${action}/${orderId}`, {}, {
                headers: { 'X-API-Key': this.apiKey }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = NotifyreProvider;