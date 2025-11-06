const axios = require('axios');
const BaseProvider = require('./base-provider');

class NumeroESIMProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/countries`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.countries) {
                return {
                    success: true,
                    data: response.data.countries.map(c => ({
                        id: c.iso,
                        name: c.name,
                        country_code: c.iso
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
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.services) {
                return {
                    success: true,
                    data: response.data.services.filter(s => s.available).map(service => ({
                        id: service.id,
                        name: service.name,
                        price: service.price,
                        stock: 999,
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
                service_id: serviceId,
                country: country
            }, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
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

            return { success: false, error: response.data?.error || 'Failed to purchase' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/sms/${orderId}`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.messages && response.data.messages.length > 0) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.messages[0].text
                    }
                };
            }

            return {
                success: true,
                data: { status: 'Waiting' }
            };
        } catch (error) {
            return this.handleError(error, 'getStatus');
        }
    }

    async cancelOrder(orderId) {
        try {
            const response = await axios.delete(`${this.baseUrl}/number/${orderId}`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            return {
                success: response.data?.success === true,
                message: 'Number cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        return { success: true, data: 'Status acknowledged' };
    }
}

module.exports = NumeroESIMProvider;