module.exports = {
    BOT_TOKEN: '8558137456:AAEahrcQvA5xQSUDoFbr1XKtXeSEZpso3Zc',
    OWNER_ID: 7804463533,
    BOT_LOGO: 'https://files.catbox.moe/8tv8rb.jpeg',
    
    // ✅ MANUAL PAYMENT CONFIG
    MANUAL_PAYMENT: {
        QRIS: {
            enabled: true,
            image_url: 'https://files.catbox.moe/tlofe0.jpg',
            name: 'QRIS Payment'
        },
        DANA: {
            enabled: true,
            number: '083834186945',
            name: 'Mohxxxx'
        },
        OVO: {
            enabled: true,
            number: '083122028438',
            name: 'jeeyxxx'
        },
        GOPAY: {
            enabled: false,
            number: '083122028438',
            name: 'jeeyxxx'
        },
        BCA: {
            enabled: false,
            account_number: '1234567890',
            account_name: 'John Doe'
        }
    },

    // ✅ CIAATOPUP PAYMENT GATEWAY
    CIAATOPUP_API_KEY: 'CiaaTopUp_qe51shcak0xrxuqt',
    CIAATOPUP_BASE_URL: 'https://ciaatopup.my.id',
    CIAATOPUP_CREATE_URL: 'https://ciaatopup.my.id/h2h/deposit/create',
    CIAATOPUP_STATUS_URL: 'https://ciaatopup.my.id/h2h/deposit/status',
    CIAATOPUP_CANCEL_URL: 'https://ciaatopup.my.id/h2h/deposit/cancel',
    
    TESTIMONI_CHANNEL: '@MarketplaceclCretatorID',
    MARKUP_PROFIT: 500,
    MAX_CHECK_ATTEMPTS: 32,

    // 🌐 20 PROVIDERS CONFIGURATION
    PROVIDERS: {
        'sms_activate': {
            enabled: true,
            name: '1',
            api_key: 'e350630d9eAfbe3482b34f35c00b966d',
            base_url: 'https://api.sms-activate.org/stubs/handler_api.php',
            type: 'global',
            priority: 1,
            description: '180+ negara, 700+ layanan, auto refund 20 menit',
            emoji: '🌐'
        },
        'fivesim': {
            enabled: true,
            name: '2',
            api_key: 'eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3OTMyODEyMDMsImlhdCI6MTc2MTc0NTIwMywicmF5IjoiMTQ5YzVkOGI2NTgyNDk1ZjdkMzExYjU2OTc3Y2IxOTMiLCJzdWIiOjM1ODEzNjN9.dZozQkKfH1FgStmDk93bXFI_mXeBC8vTSMl5l6fPGRR8FCGiH2JD0-qESGXSUdvP4-cuEbDr3iRm7jHEEql4-swHPD1HCu4RhJ8wZ1ci_3mOUaNk7_LB87pKBF13sMdqvFxAEfGw3CoVDPPtt6WbJXRKMHoQ9x-dViac3KMtFcWAfoVPO6GpGInBE3rXgUdhygGzwT4Dn78zzJ2DU9jU_N7NamWvJKQmfQi_u0XM4Fp_GJabFILnPXh5mbyyq-Q_di_cFwtVfzwCu99r4AGi97Gp3HIah8qa_bdEzwA-JiVwCTd3iMt-bVe636V6LFMO_vnqeyWySGnnyPmzlwgtQw',
            base_url: 'https://5sim.net/v1',
            type: 'global',
            priority: 2,
            description: '180+ negara, 500K+ nomor, JWT auth',
            emoji: '🌐'
        },
        'onlinesim': {
            enabled: true,
            name: '3',
            api_key: 'tQp84V5rQ7K6c56-R54FWh81-Dtbu9kSH-mCB3p6R1-5L37y6jT9aJNCp4',
            base_url: 'https://onlinesim.io/api',
            type: 'global',
            priority: 3,
            description: '90 negara, rental support, harga mulai $0.01',
            emoji: '🌐'
        },
        'sms_verification': {
            enabled: true,
            name: '4',
            api_key: '3bb07a8bbf9e088dc67dd604776ebe66',
            base_url: 'https://api.sms-verification-number.com',
            type: 'global',
            priority: 4,
            description: 'Rate limit 150 req/s, Indonesia mulai $0.20',
            emoji: '🌐'
        },
        'grizzly_sms': {
            enabled: false,
            name: 'GrizzlySMS',
            api_key: 'YOUR_GRIZZLY_API_KEY',
            base_url: 'https://api.grizzlysms.com/stubs/handler_api.php',
            type: 'global',
            priority: 5,
            description: 'Bulk account creation, ratusan nomor sekaligus',
            emoji: '🌐'
        },
        'tiger_sms': {
            enabled: true,
            name: '5',
            api_key: '97ZCElymu4FakLaD7t90V6GD4OSyxjWS',
            base_url: 'https://api.tiger-sms.com',
            type: 'global',
            priority: 6,
            description: 'Monetize SIM sendiri, high profitability',
            emoji: '🌐'
        },
        'get_sms_code': {
            enabled: false,
            name: 'GetSMSCode',
            api_key: 'YOUR_GETSMSCODE_API_KEY',
            base_url: 'https://api.getsmscode.com',
            type: 'global',
            priority: 7,
            description: 'Simple token-based, mudah integrasi',
            emoji: '🌐'
        },
        'sms_pva': {
            enabled: true,
            name: '6',
            api_key: 'У Вас нет ключа доступа к API',
            base_url: 'https://smspva.com/api',
            type: 'global',
            priority: 8,
            description: 'Support Instagram/Twitter verification',
            emoji: '🌐'
        },
        'twilio': {
            enabled: false,
            name: 'Twilio SMS',
            account_sid: 'YOUR_TWILIO_ACCOUNT_SID',
            auth_token: 'YOUR_TWILIO_AUTH_TOKEN',
            base_url: 'https://api.twilio.com/2010-04-01',
            type: 'premium',
            priority: 9,
            description: 'Enterprise grade, volume discount tersedia',
            emoji: '🌐'
        },
        'plivo': {
            enabled: false,
            name: 'Plivo',
            auth_id: 'YOUR_PLIVO_AUTH_ID',
            auth_token: 'YOUR_PLIVO_AUTH_TOKEN',
            base_url: 'https://api.plivo.com/v1',
            type: 'premium',
            priority: 10,
            description: '$0.0045/SMS, lebih murah dari Twilio',
            emoji: '🌐'
        },
        'notifyre': {
            enabled: false,
            name: 'Notifyre',
            api_key: 'YOUR_NOTIFYRE_API_KEY',
            base_url: 'https://api.notifyre.com',
            type: 'regional',
            priority: 11,
            description: 'USA termurah $0.007, 99.99% uptime',
            emoji: '🌐'
        },
        'gupshup': {
            enabled: false,
            name: 'Gupshup',
            api_key: 'YOUR_GUPSHUP_API_KEY',
            base_url: 'https://api.gupshup.io',
            type: 'regional',
            priority: 12,
            description: 'Latin America & India, $0.0025-$0.020/SMS',
            emoji: '🌐'
        },
        'rumahotp': {
            enabled: true,
            name: '7',
            api_key: 'otp_zSSPrzyeirHZhbbj',
            base_url: 'https://www.rumahotp.com/api',
            type: 'indonesia',
            priority: 13,
            description: 'Indonesia Rp1.000/nomor, lokal terpercaya',
            emoji: '🌐'
        },
        'virtusim': {
            enabled: true,
            name: 'VirtuSIM',
            api_key: 'PoRuVqUIzE5mwF38sC9cf60krtvHJY',
            base_url: 'https://virtusim.com/api',
            type: 'indonesia',
            priority: 14,
            description: 'Indonesia Rp4.000/nomor, all operator',
            emoji: '🌐'
        },
        'cloudsim': {
            enabled: false,
            name: 'CloudSIM',
            api_key: 'YOUR_CLOUDSIM_API_KEY',
            base_url: 'https://api.cloudsim.id',
            type: 'indonesia',
            priority: 15,
            description: 'Provider lokal Indonesia, harga kompetitif',
            emoji: '🌐'
        },
        'numero_esim': {
            enabled: false,
            name: 'Numero eSIM',
            api_key: 'YOUR_NUMERO_API_KEY',
            base_url: 'https://api.numero.io',
            type: 'global',
            priority: 16,
            description: '80+ negara, 400+ kota, eSIM support',
            emoji: '🌐'
        },
        'anosim': {
            enabled: true,
            name: '8',
            api_key: '8ovY0uGwOtF1UFz4SXQhPXoKwevpzIXD5bECAjauObhEw0uJ31Uzr4hFK6pVBHK3',
            base_url: 'https://api.anosim.net',
            type: 'global',
            priority: 17,
            description: 'Physical SIM, tidak double-sell',
            emoji: '🌐'
        },
        'sms_pin_verify': {
            enabled: true,
            name: '9',
            api_key: '966690bd9f70bea37227',
            base_url: 'https://api.smspinverify.com',
            type: 'global',
            priority: 18,
            description: 'Non-VoIP numbers, real carrier',
            emoji: '🌐'
        },
        'receive_sms': {
            enabled: false,
            name: 'ReceiveSMS.co',
            api_key: 'YOUR_RECEIVESMS_API_KEY',
            base_url: 'https://api.receivesms.co',
            type: 'global',
            priority: 19,
            description: 'Free tier available, banyak negara',
            emoji: '🌐'
        },
        'true_dialog': {
            enabled: false,
            name: 'TrueDialog',
            api_key: 'YOUR_TRUEDIALOG_API_KEY',
            base_url: 'https://api.truedialog.com',
            type: 'premium',
            priority: 20,
            description: '99.99% SLA uptime guarantee, enterprise',
            emoji: '🌐'
        }
    }
};
