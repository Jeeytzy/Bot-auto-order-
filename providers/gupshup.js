const axios = require('axios');
const BaseProvider = require('./base-provider');

class GupshupProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        return {
            success: true,
            data: [
                { id: 'BR', name: 'Brazil', country_code: 'BR' },
                { id: 'MX', name: 'Mexico', country_code: 'MX' },
                { id: 'IN', name: 'India', country_code: 'IN' },
                { id: 'CO', name: 'Colombia', country_code: 'CO' },
                { id: 'PE', name: 'Peru', country_code: 'PE' }
            ]
        };
    }

    async getServices(country) {
        return {
            success: true,
            data: [
                { id: 'sms', name: 'SMS Verification', price: 500, stock: 999, country: country },
                { id: 'whatsapp', name: 'WhatsApp', price: 800, stock: 999, country: country }
            ]
        };
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.post(`${this.baseUrl}/number/provision`, {
                country: country,
                type: serviceId
            }, {
                headers: { 'apikey': this.apiKey }
            });

            if (response.data && response.data.phone) {
                return {
                    success: true,
                    data: {
                        id: response.data.id.toString(),
                        number: response.data.phone,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: 'Failed to provision number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/sms/${orderId}`, {
                headers: { 'apikey': this.apiKey }
            });

            if (response.data && response.data.message) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.message
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
                headers: { 'apikey': this.apiKey }
            });

            return { success: true, message: 'Number released' };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        return { success: true, data: 'Status acknowledged' };
    }
}

module.exports = GupshupProvider;