const axios = require('axios');
const BaseProvider = require('./base-provider');

class FiveSimProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
        };
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/guest/countries`, {
                headers: this.headers
            });

            if (response.data) {
                return {
                    success: true,
                    data: Object.entries(response.data).map(([code, name]) => ({
                        id: code,
                        name: name,
                        country_code: code
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
            const response = await axios.get(`${this.baseUrl}/guest/products/${country}/any`, {
                headers: this.headers
            });

            if (response.data) {
                const services = [];
                
                for (const [serviceCode, serviceData] of Object.entries(response.data)) {
                    if (serviceData.Qty > 0) {
                        services.push({
                            id: serviceCode,
                            name: serviceData.name || serviceCode,
                            price: serviceData.Price,
                            stock: serviceData.Qty,
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
            const response = await axios.get(`${this.baseUrl}/user/buy/activation/${country}/any/${serviceId}`, {
                headers: this.headers
            });

            if (response.data && response.data.id) {
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

            return { success: false, error: 'Failed to purchase number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/user/check/${orderId}`, {
                headers: this.headers
            });

            if (response.data && response.data.status === 'RECEIVED') {
                return {
                    success: true,
                    data: {
                        status: 'Success',
                        sms: response.data.sms[0]?.code || response.data.sms
                    }
                };
            }

            if (response.data && response.data.status === 'PENDING') {
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
            const response = await axios.get(`${this.baseUrl}/user/cancel/${orderId}`, {
                headers: this.headers
            });

            return {
                success: response.data.status === 'CANCELED',
                message: 'Order cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            const statusMap = {
                '1': 'finish',
                '2': 'cancel',
                '4': 'finish'
            };

            const action = statusMap[status] || 'finish';
            const response = await axios.get(`${this.baseUrl}/user/${action}/${orderId}`, {
                headers: this.headers
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = FiveSimProvider;
