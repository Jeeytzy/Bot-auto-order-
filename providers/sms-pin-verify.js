const axios = require('axios');
const BaseProvider = require('./base-provider');

class SMSPinVerifyProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/countries`, {
                headers: { 'X-API-KEY': this.apiKey }
            });

            if (response.data && response.data.countries) {
                return {
                    success: true,
                    data: response.data.countries.map(c => ({
                        id: c.country_code,
                        name: c.country_name,
                        country_code: c.country_code
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
            const response = await axios.get(`${this.baseUrl}/api/services`, {
                params: { country: country },
                headers: { 'X-API-KEY': this.apiKey }
            });

            if (response.data && response.data.services) {
                return {
                    success: true,
                    data: response.data.services.filter(s => s.available > 0).map(service => ({
                        id: service.service_code,
                        name: service.service_name,
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
            const response = await axios.post(`${this.baseUrl}/api/rent`, {
                service: serviceId,
                country: country
            }, {
                headers: { 'X-API-KEY': this.apiKey }
            });

            if (response.data && response.data.success) {
                return {
                    success: true,
                    data: {
                        id: response.data.rental_id.toString(),
                        number: response.data.phone_number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.error || 'Failed to rent number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/sms/${orderId}`, {
                headers: { 'X-API-KEY': this.apiKey }
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

            if (response.data && response.data.status === 'waiting') {
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
            const response = await axios.post(`${this.baseUrl}/api/cancel/${orderId}`, {}, {
                headers: { 'X-API-KEY': this.apiKey }
            });

            return {
                success: response.data?.success === true,
                message: 'Rental cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            const action = status === '2' ? 'cancel' : 'complete';
            const response = await axios.post(`${this.baseUrl}/api/${action}/${orderId}`, {}, {
                headers: { 'X-API-KEY': this.apiKey }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = SMSPinVerifyProvider;