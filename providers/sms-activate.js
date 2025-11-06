const axios = require('axios');
const BaseProvider = require('./base-provider');

class SMSActivateProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'getCountries'
                }
            });

            if (response.data) {
                return {
                    success: true,
                    data: Object.entries(response.data).map(([id, data]) => ({
                        id: id,
                        name: data.eng || data.rus,
                        country_code: id
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
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'getPrices',
                    country: country
                }
            });

            if (response.data && response.data[country]) {
                const services = [];
                const countryData = response.data[country];

                for (const [serviceCode, serviceData] of Object.entries(countryData)) {
                    if (serviceData.count > 0) {
                        services.push({
                            id: serviceCode,
                            name: this.getServiceName(serviceCode),
                            price: serviceData.cost,
                            stock: serviceData.count,
                            country: country
                        });
                    }
                }

                return { success: true, data: services };
            }

            return { success: false, error: 'No services available' };
        } catch (error) {
            return this.handleError(error, 'getServices');
        }
    }

    async orderNumber(serviceId, country) {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'getNumber',
                    service: serviceId,
                    country: country
                }
            });

            if (response.data && response.data.includes('ACCESS_NUMBER')) {
                const [status, orderId, number] = response.data.split(':');
                return {
                    success: true,
                    data: {
                        id: orderId,
                        number: number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data || 'Failed to get number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'getStatus',
                    id: orderId
                }
            });

            if (response.data && response.data.includes('STATUS_OK')) {
                const smsCode = response.data.split(':')[1];
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: smsCode
                    }
                };
            }

            if (response.data === 'STATUS_WAIT_CODE') {
                return {
                    success: true,
                    data: { status: 'Waiting' }
                };
            }

            return { success: false, error: response.data };
        } catch (error) {
            return this.handleError(error, 'getStatus');
        }
    }

    async cancelOrder(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'setStatus',
                    id: orderId,
                    status: 8 // Cancel
                }
            });

            return {
                success: response.data === 'ACCESS_CANCEL',
                message: response.data
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            const statusMap = {
                '1': 1, // SMS sent
                '2': 8, // Cancel
                '4': 6  // Complete
            };

            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'setStatus',
                    id: orderId,
                    status: statusMap[status] || status
                }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }

    getServiceName(code) {
        const serviceNames = {
            'wa': 'WhatsApp',
            'tg': 'Telegram',
            'vk': 'VKontakte',
            'go': 'Google',
            'fb': 'Facebook',
            'ig': 'Instagram',
            'tw': 'Twitter',
            'ok': 'Odnoklassniki',
            'vi': 'Viber'
        };
        return serviceNames[code] || code.toUpperCase();
    }
}

module.exports = SMSActivateProvider;