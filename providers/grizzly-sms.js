const axios = require('axios');
const BaseProvider = require('./base-provider');

class GrizzlySMSProvider extends BaseProvider {
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
                    data: Object.entries(response.data).map(([id, name]) => ({
                        id: id,
                        name: name,
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
                
                for (const [serviceCode, serviceData] of Object.entries(response.data[country])) {
                    if (serviceData.count > 0) {
                        services.push({
                            id: serviceCode,
                            name: serviceCode.toUpperCase(),
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

            if (response.data && typeof response.data === 'string' && response.data.includes(':')) {
                const [status, orderId, number] = response.data.split(':');
                if (status === 'ACCESS_NUMBER') {
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

            if (response.data && typeof response.data === 'string') {
                if (response.data.includes('STATUS_OK')) {
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
                    status: 8
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
            const statusMap = { '1': 1, '2': 8, '4': 6 };
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
}

module.exports = GrizzlySMSProvider;