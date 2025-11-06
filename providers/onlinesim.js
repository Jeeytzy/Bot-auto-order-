const axios = require('axios');
const BaseProvider = require('./base-provider');

class OnlineSimProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }

    async getCountries() {
        try {
            const response = await axios.get(`${this.baseUrl}/getCountries.php`, {
                params: { apikey: this.apiKey }
            });

            if (response.data && response.data.response === '1') {
                return {
                    success: true,
                    data: response.data.countries.map(country => ({
                        id: country.country,
                        name: country.country_text,
                        country_code: country.country
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
            const response = await axios.get(`${this.baseUrl}/getNumbersStats.php`, {
                params: {
                    apikey: this.apiKey,
                    country: country
                }
            });

            if (response.data && response.data.response === '1') {
                const services = [];
                
                for (const [serviceCode, serviceData] of Object.entries(response.data.services || {})) {
                    if (serviceData.count > 0) {
                        services.push({
                            id: serviceCode,
                            name: serviceData.service || serviceCode,
                            price: serviceData.price,
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
            const response = await axios.get(`${this.baseUrl}/getNum.php`, {
                params: {
                    apikey: this.apiKey,
                    service: serviceId,
                    country: country
                }
            });

            if (response.data && response.data.response === '1') {
                return {
                    success: true,
                    data: {
                        id: response.data.tzid.toString(),
                        number: response.data.number,
                        service: serviceId,
                        country: country
                    }
                };
            }

            return { success: false, error: response.data?.msg || 'Failed to get number' };
        } catch (error) {
            return this.handleError(error, 'orderNumber');
        }
    }

    async getStatus(orderId) {
        try {
            const response = await axios.get(`${this.baseUrl}/getState.php`, {
                params: {
                    apikey: this.apiKey,
                    tzid: orderId
                }
            });

            if (response.data && response.data.response === '1') {
                if (response.data[0]?.msg) {
                    return {
                        success: true,
                        data: {
                            status: 'Success',
                            sms: response.data[0].msg
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
            const response = await axios.get(`${this.baseUrl}/setOperationRevise.php`, {
                params: {
                    apikey: this.apiKey,
                    tzid: orderId
                }
            });

            return {
                success: response.data?.response === '1',
                message: 'Order cancelled'
            };
        } catch (error) {
            return this.handleError(error, 'cancelOrder');
        }
    }

    async setStatus(orderId, status) {
        try {
            let action = 'setOperationOk.php';
            if (status === '2') {
                action = 'setOperationRevise.php';
            }

            const response = await axios.get(`${this.baseUrl}/${action}`, {
                params: {
                    apikey: this.apiKey,
                    tzid: orderId
                }
            });

            return { success: true, data: response.data };
        } catch (error) {
            return this.handleError(error, 'setStatus');
        }
    }
}

module.exports = OnlineSimProvider;