const axios = require('axios');
const BaseProvider = require('./base-provider');

class PlivoProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.authId = config.auth_id;
        this.authToken = config.auth_token;
        this.auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');
    }

    async getCountries() {
        return {
            success: true,
            data: [
                { id: 'US', name: 'United States', country_code: 'US' },
                { id: 'GB', name: 'United Kingdom', country_code: 'GB' },
                { id: 'CA', name: 'Canada', country_code: 'CA' }
            ]
        };
    }

    async getServices(country) {
        return {
            success: true,
            data: [
                { id: 'sms', name: 'SMS Service', price: 900, stock: 999, country: country }
            ]
        };
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/Account/${this.authId}/PhoneNumber/`,
                { country_iso: country, type: 'local' },
                {
                    headers: {
                        'Authorization': `Basic ${this.auth}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.number) {
                return {
                    success: true,
                    data: {
                        id: response.data.number,
                        number: response.data.number.replace('+', ''),
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: 'Failed to rent number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/Account/${this.authId}/Message/?limit=1`,
                {
                    headers: { 'Authorization': `Basic ${this.auth}` }
                }
            );

            if (response.data && response.data.objects && response.data.objects.length > 0) {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.objects[0].text
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
            await axios.delete(
                `${this.baseUrl}/Account/${this.authId}/PhoneNumber/${orderId}/`,
                {
                    headers: { 'Authorization': `Basic ${this.auth}` }
                }
            );

            return { success: true, message: 'Number released' };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        return { success: true, data: 'Status acknowledged' };
    }
}

module.exports = PlivoProvider;