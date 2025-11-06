const axios = require('axios');
const BaseProvider = require('./base-provider');

class TrueDialogProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        return {
            success: true,
            data: [
                { id: 'US', name: 'United States', country_code: 'US' },
                { id: 'CA', name: 'Canada', country_code: 'CA' }
            ]
        };
    }

    async getServices(country) {
        return {
            success: true,
            data: [
                { id: 'sms', name: 'Premium SMS', price: 2000, stock: 999, country: country }
            ]
        };
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.post(`${this.baseUrl}/number/purchase`, {
                country: country,
                type: 'local'
            }, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.phone_number) {
                return {
                    success: true,
                    data: {
                        id: response.data.number_id.toString(),
                        number: response.data.phone_number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: 'Failed to purchase number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/messages`, {
                params: { number_id: orderId },
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            if (response.data && response.data.messages && response.data.messages.length > 0) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.messages[0].body
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

            return { success: true, message: 'Number released' };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        return { success: true, data: 'Status acknowledged' };
    }
}

module.exports = TrueDialogProvider;