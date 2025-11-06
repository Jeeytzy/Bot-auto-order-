const config = require('../config');

// Import all 20 providers
const SMSActivateProvider = require('../providers/sms-activate');
const FiveSimProvider = require('../providers/fivesim');
const OnlineSimProvider = require('../providers/onlinesim');
const SMSVerificationProvider = require('../providers/sms-verification');
const GrizzlySMSProvider = require('../providers/grizzly-sms');
const TigerSMSProvider = require('../providers/tiger-sms');
const GetSMSCodeProvider = require('../providers/get-sms-code');
const SMSPVAProvider = require('../providers/sms-pva');
const TwilioProvider = require('../providers/twilio');
const PlivoProvider = require('../providers/plivo');
const NotifyreProvider = require('../providers/notifyre');
const GupshupProvider = require('../providers/gupshup');
const RumahOTPProvider = require('../providers/rumahotp');
const VirtuSIMProvider = require('../providers/virtusim');
const CloudSIMProvider = require('../providers/cloudsim');
const NumeroESIMProvider = require('../providers/numero-esim');
const AnosimProvider = require('../providers/anosim');
const SMSPinVerifyProvider = require('../providers/sms-pin-verify');
const ReceiveSMSProvider = require('../providers/receive-sms');
const TrueDialogProvider = require('../providers/true-dialog');

class ProviderManager {
    constructor() {
        this.providers = {};
        this.initializeProviders();
    }

    initializeProviders() {
        const providerClasses = {
            'sms_activate': SMSActivateProvider,
            'fivesim': FiveSimProvider,
            'onlinesim': OnlineSimProvider,
            'sms_verification': SMSVerificationProvider,
            'grizzly_sms': GrizzlySMSProvider,
            'tiger_sms': TigerSMSProvider,
            'get_sms_code': GetSMSCodeProvider,
            'sms_pva': SMSPVAProvider,
            'twilio': TwilioProvider,
            'plivo': PlivoProvider,
            'notifyre': NotifyreProvider,
            'gupshup': GupshupProvider,
            'rumahotp': RumahOTPProvider,
            'virtusim': VirtuSIMProvider,
            'cloudsim': CloudSIMProvider,
            'numero_esim': NumeroESIMProvider,
            'anosim': AnosimProvider,
            'sms_pin_verify': SMSPinVerifyProvider,
            'receive_sms': ReceiveSMSProvider,
            'true_dialog': TrueDialogProvider
        };

        // Initialize enabled providers only
        for (const [key, providerConfig] of Object.entries(config.PROVIDERS)) {
            if (providerConfig.enabled) {
                const ProviderClass = providerClasses[key];
                if (ProviderClass) {
                    this.providers[key] = new ProviderClass(providerConfig);
                    console.log(`✅ Initialized provider: ${providerConfig.name} (${key})`);
                } else {
                    console.warn(`⚠️  Provider class not found for: ${key}`);
                }
            } else {
                console.log(`⏭️  Skipped disabled provider: ${providerConfig.name} (${key})`);
            }
        }

        console.log(`\n🎯 Total active providers: ${Object.keys(this.providers).length}/20\n`);
    }

    getProvider(providerKey) {
        const provider = this.providers[providerKey];
        if (!provider) {
            throw new Error(`Provider "${providerKey}" not found or disabled`);
        }
        return provider;
    }

    getAllProviders() {
        return this.providers;
    }

    getEnabledProviders() {
        return Object.entries(config.PROVIDERS)
            .filter(([key, cfg]) => cfg.enabled && this.providers[key])
            .map(([key, cfg]) => ({
                key: key,
                name: cfg.name,
                emoji: cfg.emoji,
                type: cfg.type,
                priority: cfg.priority,
                description: cfg.description
            }))
            .sort((a, b) => a.priority - b.priority);
    }

    getProvidersByType(type) {
        return Object.entries(this.providers)
            .filter(([key, provider]) => config.PROVIDERS[key].type === type)
            .map(([key, provider]) => ({
                key: key,
                name: config.PROVIDERS[key].name,
                emoji: config.PROVIDERS[key].emoji,
                provider: provider
            }));
    }

    async testProvider(providerKey) {
        try {
            const provider = this.getProvider(providerKey);
            const result = await provider.getCountries();
            return {
                success: result.success,
                provider: providerKey,
                message: result.success ? 'Provider working' : 'Provider failed'
            };
        } catch (error) {
            return {
                success: false,
                provider: providerKey,
                message: error.message
            };
        }
    }
}

module.exports = ProviderManager;