const axios = require('axios');
const BaseProvider = require('./base-provider');

class RumahOTPProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.map(c => ({
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
            const response = await axios.get(`${this.baseUrl}/operators-v2`, {
                params: { country: country },
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.filter(s => s.stock > 0).map(service => ({
                        id: service.operator_id,
                        name: service.operator_name,
                        price: service.price,
                        stock: service.stock,
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
            const response = await axios.post(`${this.baseUrl}/order`, {
                operator_id: serviceId,
                country: country
            }, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.success) {
                return {
                    success: true,
                    data: {
                        id: response.data.data.id.toString(),
                        number: response.data.data.number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.message || 'Failed to order' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/order/${orderId}`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.data && response.data.data.otp) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.data.otp
                    }
                };
            }

            if (response.data && response.data.data && response.data.data.status === 'pending') {
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
            const response = await axios.post(`${this.baseUrl}/order/${orderId}/cancel`, {}, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
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
            const response = await axios.post(`${this.baseUrl}/order/${orderId}/${action}`, {}, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = RumahOTPProvider;