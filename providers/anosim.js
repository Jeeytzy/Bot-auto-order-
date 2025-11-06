const axios = require('axios');
const BaseProvider = require('./base-provider');

class AnosimProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                headers: { 'API-Key': this.apiKey }
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
            const response = await axios.get(`${this.baseUrl}/services/${country}`, {
                headers: { 'API-Key': this.apiKey }
            });

            if (response.data && response.data.services) {
                return {
                    success: true,
                    data: response.data.services.filter(s => s.stock > 0).map(service => ({
                        id: service.service_id,
                        name: service.service_name,
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
            const response = await axios.post(`${this.baseUrl}/order/create`, {
                service: serviceId,
                country: country
            }, {
                headers: { 'API-Key': this.apiKey }
            });

            if (response.data && response.data.success) {
                return {
                    success: true,
                    data: {
                        id: response.data.order_id.toString(),
                        number: response.data.phone_number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.message || 'Failed to create order' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/order/${orderId}`, {
                headers: { 'API-Key': this.apiKey }
            });

            if (response.data && response.data.sms_code) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.sms_code
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
            const response = await axios.post(`${this.baseUrl}/order/${orderId}/cancel`, {}, {
                headers: { 'API-Key': this.apiKey }
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
            const response = await axios.post(`${this.baseUrl}/order/${orderId}/${action}`, {}, {
                headers: { 'API-Key': this.apiKey }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = AnosimProvider;