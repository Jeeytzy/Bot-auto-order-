const axios = require('axios');
const BaseProvider = require('./base-provider');

class VirtuSIMProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'list_country'
                },
                timeout: 30000
            });

            if (response.data && response.data.status && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.map(c => ({
                        id: c.country_name,
                        name: c.country_name,
                        country_code: c.country_name
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
                    action: 'services',
                    country: country
                },
                timeout: 30000
            });

            if (response.data && response.data.status && response.data.data) {
                return {
                    success: true,
                    data: response.data.data.filter(s => parseInt(s.tersedia) > 0).map(service => ({
                        id: service.id,
                        name: service.name,
                        price: parseInt(service.price),
                        stock: parseInt(service.tersedia),
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
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'order',
                    service: serviceId,
                    operator: 'any'
                },
                timeout: 30000
            });

            if (response.data && response.data.status && response.data.data) {
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

            return { success: false, error: response.data?.data?.msg || 'Failed to order' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'status',
                    id: orderId
                },
                timeout: 30000
            });

            if (response.data && response.data.status && response.data.data) {
                if (response.data.data.status === 'Success' && response.data.data.sms) {
                    return {
                        success: true,
                        data: {
                            status: 'Success',
                            sms: response.data.data.sms
                        }
                    };
                }

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
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'set_status',
                    id: orderId,
                    status: '2'
                },
                timeout: 30000
            });

            return {
                success: response.data?.status === true,
                message: 'Order cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            const response = await axios.get(`${this.baseUrl}`, {
                params: {
                    api_key: this.apiKey,
                    action: 'set_status',
                    id: orderId,
                    status: status
                },
                timeout: 30000
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = VirtuSIMProvider;