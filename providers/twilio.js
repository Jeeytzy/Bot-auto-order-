const axios = require('axios');
const BaseProvider = require('./base-provider');

class TwilioProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.accountSid = config.account_sid;
        this.authToken = config.auth_token;
        this.auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    }

    async getCountries() {
        // Twilio support manual - return common countries
        return {
            success: true,
            data: [
                { id: 'US', name: 'United States', country_code: 'US' },
                { id: 'CA', name: 'Canada', country_code: 'CA' },
                { id: 'GB', name: 'United Kingdom', country_code: 'GB' },
                { id: 'AU', name: 'Australia', country_code: 'AU' }
            ]
        };
    }

    async getServices(country) {
        // Twilio generic services
        return {
            success: true,
            data: [
                { id: 'sms', name: 'SMS Service', price: 1000, stock: 999, country: country }
            ]
        };
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/Accounts/${this.accountSid}/IncomingPhoneNumbers.json`,
                `AreaCode=&SmsUrl=https://yourwebhook.com/sms`,
                {
                    headers: {
                        'Authorization': `Basic ${this.auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            if (response.data && response.data.phone_number) {
                return {
                    success: true,
                    data: {
                        id: response.data.sid,
                        number: response.data.phone_number.replace('+', ''),
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
            const response = await axios.get(
                `${this.baseUrl}/Accounts/${this.accountSid}/Messages.json?To=${orderId}`,
                {
                    headers: { 'Authorization': `Basic ${this.auth}` }
                }
            );

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
            const response = await axios.delete(
                `${this.baseUrl}/Accounts/${this.accountSid}/IncomingPhoneNumbers/${orderId}.json`,
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
        // Twilio doesn't need explicit status setting
        return { success: true, data: 'Status acknowledged' };
    }
}

module.exports = TwilioProvider;