const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { EventEmitter } = require('events');
const config = require('./config.js');
const ProviderManager = require('./utils/provider-manager');

// Enhanced services untuk produk digital
const logger = require('./services/logger');
const security = require('./services/security');
const validation = require('./services/validation');
const storage = require('./services/storage');
const payments = require('./services/payments');
const notifications = require('./services/notifications');
const EnhancedDatabaseManager = require('./services/database-enhanced');
const ProductHandler = require('./services/product-handler');
const ProductOperations = require('./services/product-operations');

class AtomicFileManager {
    constructor() {
        this.writeQueue = new Map();
        this.locks = new Map();
    }

    async acquireLock(filePath) {
        const lockKey = path.resolve(filePath);
        while (this.locks.has(lockKey)) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.locks.set(lockKey, true);
        return lockKey;
    }

    async releaseLock(lockKey) {
        this.locks.delete(lockKey);
    }

    async atomicWrite(filePath, data) {
        const lockKey = await this.acquireLock(filePath);
        try {
            const tempFile = `${filePath}.${Date.now()}.tmp`;
            await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
            await fs.rename(tempFile, filePath);
        } finally {
            await this.releaseLock(lockKey);
        }
    }

    async atomicRead(filePath, defaultValue = null) {
        const lockKey = await this.acquireLock(filePath);
        try {
            try {
                const data = await fs.readFile(filePath, 'utf8');
                return JSON.parse(data);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return defaultValue;
                }
                throw error;
            }
        } finally {
            await this.releaseLock(lockKey);
        }
    }
}

class JobQueue {
    constructor(concurrency = 1) {
        this.queue = [];
        this.workers = [];
        this.running = 0;
        this.concurrency = concurrency;
        this.eventEmitter = new EventEmitter();
    }

    addJob(job) {
        this.queue.push(job);
        this.process();
    }

    async process() {
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const job = this.queue.shift();

        try {
            const result = await job();
            this.eventEmitter.emit('completed', { job, result });
        } catch (error) {
            this.eventEmitter.emit('failed', { job, error });
        } finally {
            this.running--;
            this.process();
        }
    }

    on(event, listener) {
        this.eventEmitter.on(event, listener);
    }
}

class DatabaseManager {
    constructor() {
        this.fileManager = new AtomicFileManager();
        this.dataFile = 'data.json';
        this.ordersFile = 'orders.json';
        this.historyFile = 'history.json';
        this.topFile = 'top.json';
        this.userFile = 'user.json';
        this.pendingManualDepositsFile = 'pendingManualDeposits.json';
        this.productsFile = 'products.json';
        this.productOrdersFile = 'productOrders.json';
        this.bannedUsersFile = 'bannedUsers.json';
        this.rateLimitFile = 'rateLimit.json';
        this.integrityChecksum = null;
    }

    async initialize() {
        const fsSync = require('fs');
        const files = [
            { path: this.dataFile, default: [] },
            { path: this.ordersFile, default: {} },
            { path: this.historyFile, default: {} },
            { path: this.topFile, default: [] },
            { path: this.userFile, default: [] },
            { path: this.pendingManualDepositsFile, default: [] },
            { path: this.productsFile, default: [] },
            { path: this.productOrdersFile, default: [] },
            { path: this.bannedUsersFile, default: [] },
            { path: this.rateLimitFile, default: {} }
        ];

        for (const file of files) {
            try {
                if (!fsSync.existsSync(file.path)) {
                    await fs.writeFile(file.path, JSON.stringify(file.default, null, 2));
                    console.log(`✅ Created ${file.path}`);
                }
            } catch (error) {
                console.error(`Error creating ${file.path}:`, error);
            }
        }
        
        await this.verifyIntegrity();
    }

    async loadUsers() {
        return await this.fileManager.atomicRead(this.dataFile, []);
    }

    async saveUsers(users) {
        await this.fileManager.atomicWrite(this.dataFile, users);
    }

    async loadOrders() {
        return await this.fileManager.atomicRead(this.ordersFile, {});
    }

    async saveOrders(orders) {
        await this.fileManager.atomicWrite(this.ordersFile, orders);
    }

    async loadHistory() {
        return await this.fileManager.atomicRead(this.historyFile, {});
    }

    async saveHistory(history) {
        await this.fileManager.atomicWrite(this.historyFile, history);
    }

    async loadTop() {
        return await this.fileManager.atomicRead(this.topFile, []);
    }

    async saveTop(top) {
        await this.fileManager.atomicWrite(this.topFile, top);
    }

    async loadBroadcastUsers() {
        return await this.fileManager.atomicRead(this.userFile, []);
    }

    async saveBroadcastUsers(users) {
        await this.fileManager.atomicWrite(this.userFile, users);
    }

    async loadPendingManualDeposits() {
        return await this.fileManager.atomicRead(this.pendingManualDepositsFile, []);
    }

    async savePendingManualDeposits(deposits) {
        await this.fileManager.atomicWrite(this.pendingManualDepositsFile, deposits);
    }

    async loadProducts() {
        return await this.fileManager.atomicRead(this.productsFile, []);
    }

    async saveProducts(products) {
        await this.fileManager.atomicWrite(this.productsFile, products);
    }

    async loadProductOrders() {
        const data = await this.fileManager.atomicRead(this.productOrdersFile, []);
        return Array.isArray(data) ? data : [];
    }

    async saveProductOrders(orders) {
        await this.fileManager.atomicWrite(this.productOrdersFile, orders);
    }

    async loadBannedUsers() {
        return await this.fileManager.atomicRead(this.bannedUsersFile, []);
    }

    async saveBannedUsers(bannedUsers) {
        await this.fileManager.atomicWrite(this.bannedUsersFile, bannedUsers);
    }

    async loadRateLimit() {
        return await this.fileManager.atomicRead(this.rateLimitFile, {});
    }

    async saveRateLimit(rateLimit) {
        await this.fileManager.atomicWrite(this.rateLimitFile, rateLimit);
    }

    async verifyIntegrity() {
        try {
            const critical = ['products.json', 'data.json', 'productOrders.json'];
            for (const file of critical) {
                const data = await this.fileManager.atomicRead(file, null);
                if (data === null) {
                    console.warn(`⚠️ Integrity check: ${file} might be corrupted`);
                }
            }
            return true;
        } catch (error) {
            console.error('❌ Integrity verification failed:', error);
            return false;
        }
    }
}

async function editPhotoCaption(bot, chatId, msgId, photoUrl, text, keyboard) {
  try {
    const validKeyboard = keyboard && keyboard.inline_keyboard && keyboard.inline_keyboard.length > 0 
      ? keyboard 
      : { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] };
    
    return await bot.editMessageCaption(text, {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: validKeyboard,
      parse_mode: 'Markdown'
    });
  } catch (e) {
    if (e.response?.body?.description?.includes("can't be edited")) {
      try { await bot.deleteMessage(chatId, msgId); } catch (_) {}
      
      const validKeyboard = keyboard && keyboard.inline_keyboard && keyboard.inline_keyboard.length > 0 
        ? keyboard 
        : { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] };
      
      return await bot.sendPhoto(chatId, photoUrl, {
        caption: text,
        reply_markup: validKeyboard,
        parse_mode: 'Markdown'
      });
    }
    throw e;
  }
}

class VirtuSIMBot {
    constructor() {
        this.config = config;
        
        // Feature flags - Set to false to disable SMS/nokos features (keep code dormant)
        this.SMS_ENABLED = false;

        this.bot = new TelegramBot(this.config.BOT_TOKEN, { 
            polling: true,
            filepath: false
        });
        
        this.bot.on('polling_error', (error) => {
            console.error('Polling error:', error.code, error.message);
            if (error.code === 'EFATAL') {
                console.log('Restarting bot...');
                process.exit(1);
            }
        });
        
        const originalEditMessageText = this.bot.editMessageText;
        this.bot.editMessageText = async function(text, options) {
            try {
                return await originalEditMessageText.call(this, text, options);
            } catch (error) {
                if (error.response?.body?.description?.includes('message is not modified')) {
                    return;
                }
                throw error;
            }
        };

        this.providerManager = new ProviderManager();
        this.userProviders = new Map();
        
        this.processingCallbacks = new Set();
        this.botLogo = 'https://files.catbox.moe/d49amr.png';
        this.db = new DatabaseManager();
        this.enhancedDb = new EnhancedDatabaseManager(this.db);
        this.jobQueue = new JobQueue(5);
        this.activeMonitors = new Map();
        this.userLocks = new Map();
        this.pendingOrders = new Set();
        this.refundLocks = new Set();
        this.autoPending = [];
        this.productAddStates = new Map();
        this.paymentProofStates = new Map();

        // Initialize enhanced services
        storage.setBot(this.bot);
        payments.setConfig(this.config);
        notifications.setBot(this.bot, this.config);
        
        // Initialize product handlers
        this.productHandler = new ProductHandler(this.bot, this.config, this.db, this.enhancedDb);
        this.productOps = new ProductOperations(this.bot, this.config, this.db, this.enhancedDb);
        
        logger.info('Bot initialization starting', { 
            providers: Object.keys(this.providerManager.providers).length 
        });

        this.initPromise = this.initializeBot();
        this.setupErrorHandling();
        this.setupHandlers();
        this.startDepositMonitoring();
        this.startCleanupWorker();

        console.log('🤖 Multi-Provider SMS Bot started!');
        logger.info('Multi-Provider SMS Bot fully initialized');
        console.log(`🌐 Active providers: ${Object.keys(this.providerManager.providers).length}/20`);
    }

    async initializeBot() {
        try {
            await this.db.initialize();
            console.log('✅ Database initialized');
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            process.exit(1);
        }
    }

    setupErrorHandling() {
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });

        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
        });

        this.jobQueue.on('failed', ({ job, error }) => {
            console.error('Job failed:', error);
        });
    }

    setupHandlers() {
        this.bot.onText(/\/start/, (msg) => this.jobQueue.addJob(() => this.handleStart(msg)));
        this.bot.onText(/\/del (\d+)/, (msg, match) => this.jobQueue.addJob(() => this.handleDelete(msg, match)));
        this.bot.onText(/\/info (\d+)/, (msg, match) => this.jobQueue.addJob(() => this.handleInfo(msg, match)));
        this.bot.onText(/\/deposit(?: (\d+))?/, (msg, match) => this.jobQueue.addJob(() => this.handleDeposit(msg, match)));
        this.bot.onText(/\/deposit_manual (\d+)/, (msg, match) => this.jobQueue.addJob(() => this.handleDepositManual(msg, match)));
        this.bot.onText(/\/reff (\d+) (\d+)/, (msg, match) => this.jobQueue.addJob(() => this.handleReffCommand(msg, match)));
        this.bot.onText(/\/bc (.+)/s, (msg, match) => this.jobQueue.addJob(() => this.handleBroadcast(msg, match)));
        this.bot.onText(/\/produk_add/, (msg) => this.jobQueue.addJob(() => this.productHandler.handleProdukAdd(msg)));
        this.bot.onText(/\/produk_list/, (msg) => this.jobQueue.addJob(() => this.handleProdukList(msg)));
        this.bot.onText(/\/delproduk (.+)/, (msg, match) => this.jobQueue.addJob(() => this.handleDelProduk(msg, match)));
        this.bot.onText(/\/history_produk/, (msg) => this.jobQueue.addJob(() => this.handleHistoryProduk(msg)));
        
        this.bot.on('callback_query', (query) => this.jobQueue.addJob(() => this.handleCallback(query)));
        
        this.bot.on('photo', (msg) => {
            if (msg.caption && msg.caption.startsWith('/bc ')) {
                this.jobQueue.addJob(() => this.handlePhotoBroadcast(msg));
            } else {
                const userId = msg.from.id;
                const state = this.productHandler.productAddStates.get(userId);
                if (state) {
                    this.jobQueue.addJob(() => this.productHandler.handlePhotoUpload(msg));
                } else {
                    this.jobQueue.addJob(() => this.handlePhotoUpload(msg));
                }
            }
        });

        this.bot.on('document', (msg) => {
            const userId = msg.from.id;
            const state = this.productHandler.productAddStates.get(userId);
            if (state) {
                this.jobQueue.addJob(() => this.productHandler.handleDocumentUpload(msg));
            } else {
                this.jobQueue.addJob(() => this.handleDocumentUpload(msg));
            }
        });

        this.bot.on('message', (msg) => {
            const userId = msg.from.id;
            const state = this.productHandler.productAddStates.get(userId);
            
            if (state && msg.text && !msg.text.startsWith('/')) {
                this.jobQueue.addJob(() => this.productHandler.handleProductAddStep(msg, state));
            }
        });
    }

    async sendPhotoMessage(chatId, text, keyboard, deleteMessageId = null) {
        if (deleteMessageId) {
            try {
                await this.bot.deleteMessage(chatId, deleteMessageId);
            } catch (error) {
                console.log('Cannot delete message:', error.message);
            }
        }
        
        return await this.bot.sendPhoto(chatId, this.botLogo, {
            caption: text,
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        });
    }

    async handleStart(msg) {
        if (msg.chat.type !== 'private') {
            return this.bot.sendMessage(msg.chat.id, "⚠️ Bot ini hanya bekerja di private chat.");
        }
        
        const userId = msg.from.id;
        await this.addUserToBroadcastList(userId);
        const user = await this.getUser(userId);
       
        const uniqueUsers = await this.loadUniqueUsers();
        const usersWithBalance = await this.getUsersWithBalance();

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🛍️ Produk Digital', callback_data: 'produk_digital' },
                    { text: '💰 Cek Saldo', callback_data: 'check_balance' }
                ],
                [
                    { text: '📋 Pesanan Aktif', callback_data: 'active_orders' },
                    { text: '📜 Riwayat Order', callback_data: 'order_history' }
                ],
                [
                    { text: '💳 Top Up', callback_data: 'topup' },
                    { text: '🏆 Top Users', callback_data: 'top_users' }
                ],
                [
                    { text: '📜 Syarat & Ketentuan', callback_data: 'rules' },
                    { text: 'ℹ️ Bantuan', callback_data: 'help' }
                ]
            ]
        };

        if (userId === this.config.OWNER_ID) {
            keyboard.inline_keyboard.push([
                { text: '👑 Owner Panel', callback_data: 'owner_panel' }
            ]);
        }

        const timeInfo = this.getIndonesianTime();
        const saldoDisplay = user ? user.saldo.toLocaleString('id-ID') : '0';
        const sanitizeName = (name) => {
            if (!name) return 'Tidak ada';
            return name.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        };
        
        const username = msg.from.username ? '@' + sanitizeName(msg.from.username) : 'Tidak ada';
        
        const welcomeText = user ? 
            `👋 *Selamat Datang Kembali!*\n\nHalo ${msg.from.first_name}! Senang melihat Anda lagi.\n\n` :
            `🌟 *Selamat Datang di Multi-Provider SMS Bot!*\n\nHalo ${msg.from.first_name}! Selamat bergabung.\n\n`;
        
        const enabledProviders = this.providerManager.getEnabledProviders();
        
        const fullText = welcomeText +
            `👤 *Info Akun:*\n` +
            `Username: ${username}\n` +
            `ID: \`${userId}\`\n` +
            `📅 Tanggal: ${timeInfo.date}\n` +
            `🕐 Jam: ${timeInfo.time}\n\n` +
            `💰 Saldo: *Rp ${saldoDisplay}*\n\n` +
            `📊 *Statistik Bot:*\n` +
            `👥 Total User: ${uniqueUsers.length}\n` +
            `💳 Total User Deposit: ${usersWithBalance.length}\n` +
            `🌐 Total Server: ${enabledProviders.length} providers\n\n` +
            `🤖 *Fitur Otomatis:*\n` +
            `✅ Beli nomor instan\n` +
            `✅ Terima SMS otomatis\n` +
            `✅ Selesai otomatis\n` +
            `✅ Refund otomatis jika gagal\n` +
            `✅ 20 Provider global\n\n` +
            `⚠️ *DISCLAIMER:*\n` +
            `• Bot tidak bertanggung jawab jika OTP sudah dikirim ke chat ini\n` +
            `• Saldo yang ada di bot TIDAK BISA di-refund\n\n` +
            `👨‍💻 *Bot Creator:* @Jeeyhosting\n\n` +
            `Pilih menu di bawah:`;

        await this.bot.sendPhoto(msg.chat.id, this.botLogo, {
            caption: fullText,
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        });
    }

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const userId = query.from.id;
        const callbackKey = `${chatId}_${messageId}_${data}`;

        if (this.processingCallbacks.has(callbackKey)) {
            await this.bot.answerCallbackQuery(query.id, {
                text: "Sedang memproses, tunggu...",
                show_alert: false
            });
            return; 
        }

        this.processingCallbacks.add(callbackKey);
        await this.bot.answerCallbackQuery(query.id);

        try {
            const handlers = {
                'top_users': () => this.showTopUsers(chatId, messageId),
                'top_saldo': () => this.showTopSaldo(chatId, messageId),
                'top_orders': () => this.showTopOrders(chatId, messageId),
                'buy_start': () => {
                    if (!this.SMS_ENABLED) {
                        return this.bot.answerCallbackQuery(query.id, {
                            text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                            show_alert: true
                        });
                    }
                    return this.showServerSelection(chatId, messageId, userId);
                },
                'check_balance': () => this.checkBalance(chatId, messageId, userId),
                'active_orders': () => this.showActiveOrders(chatId, messageId, userId),
                'order_history': () => this.showOrderHistory(chatId, messageId, userId),
                'product_history': () => this.showProductHistory(chatId, messageId, userId),
                'topup': () => this.showTopup(chatId, messageId),
                'help': () => this.showHelp(chatId, messageId),
                'rules': () => this.showRules(chatId, messageId),
                'owner_panel': () => this.showOwnerPanel(chatId, messageId, userId),
                'owner_stats': () => this.showOwnerStats(chatId, messageId, userId),
                'owner_saldo': () => this.showOwnerSaldo(chatId, messageId, userId),
                'owner_orders': () => this.showOwnerOrders(chatId, messageId, userId),
                'owner_manual_deposits': () => this.showOwnerManualDeposits(chatId, messageId, userId),
                'owner_products': () => this.showOwnerProducts(chatId, messageId, userId),
                'owner_product_orders': () => this.showOwnerProductOrders(chatId, messageId, userId),
                'add_product_start': () => this.handleAddProductStart(chatId, messageId, userId),
                'back_main': () => this.showMainMenu(chatId, messageId, userId),
                'produk_digital': () => this.productOps.showProdukDigital(chatId, messageId, userId)
            };

            if (data.startsWith('select_server_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                const serverKey = data.replace('select_server_', '');
                await this.handleServerSelection(chatId, messageId, userId, serverKey);
            } else if (data.startsWith('servers_page_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                const page = parseInt(data.replace('servers_page_', ''));
                await this.showServerSelection(chatId, messageId, userId, page);
            } else if (data.startsWith('countries_page_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                const page = parseInt(data.replace('countries_page_', ''));
                await this.showCountries(chatId, messageId, userId, page);
            } else if (data.startsWith('country_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                await this.showServices(chatId, messageId, data, userId);
            } else if (data.startsWith('service_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                await this.confirmPurchase(chatId, messageId, data, userId);
            } else if (data.startsWith('buy_confirm_')) {
                if (!this.SMS_ENABLED) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                        show_alert: true
                    });
                }
                await this.processPurchase(chatId, messageId, data, userId);
            } else if (data.startsWith('cancel_')) {
                if (data === 'cancel_processing') {
                    await this.bot.answerCallbackQuery(query.id, { 
                        text: 'Sedang memproses pembatalan, harap tunggu...', 
                        show_alert: true 
                    });
                } else if (data === 'cancel_wait_5_minutes') {
                    await this.bot.answerCallbackQuery(query.id, { 
                        text: 'Button cancel akan muncul dalam 5 menit setelah order. Silakan tunggu.', 
                        show_alert: true 
                    });
                } else if (data.startsWith('cancel_deposit_')) {
                    await this.cancelDeposit(query);
                } else {
                    // Cancel SMS order - guard with SMS_ENABLED flag
                    if (!this.SMS_ENABLED) {
                        return this.bot.answerCallbackQuery(query.id, {
                            text: '⚠️ Fitur SMS sementara tidak tersedia. Gunakan menu Produk Digital!',
                            show_alert: true
                        });
                    }
                    await this.cancelOrder(chatId, messageId, data, userId);
                }
            } else if (data.startsWith('approve_manual_') || data.startsWith('appr_man_')) {
                await this.approveManualDeposit(chatId, messageId, data, userId, query);
            } else if (data.startsWith('reject_manual_') || data.startsWith('rej_man_')) {
                await this.rejectManualDeposit(chatId, messageId, data, userId, query);
            } else if (data.startsWith('delete_product_') || data.startsWith('del_prod_')) {
                await this.deleteProduct(chatId, messageId, data, userId);
            } else if (data.startsWith('buy_product_')) {
                await this.productOps.confirmProductPurchase(chatId, messageId, data, userId);
            } else if (data.startsWith('confirm_buy_product_')) {
                await this.productOps.processProductPurchase(chatId, messageId, data, userId, query);
            } else if (data.startsWith('approve_product_payment_') || data.startsWith('appr_prod_')) {
                await this.approveProductPayment(chatId, messageId, data, userId, query);
            } else if (data.startsWith('reject_product_payment_') || data.startsWith('rej_prod_')) {
                await this.rejectProductPayment(chatId, messageId, data, userId, query);
            } else if (data.startsWith('produk_page_')) {
                const page = parseInt(data.replace('produk_page_', ''));
                await this.productOps.showProdukDigital(chatId, messageId, userId, page);
            } else if (data.startsWith('product_payment_')) {
                const method = data.replace('product_payment_', '');
                const state = this.productHandler.productAddStates.get(userId);
                if (state && state.step === 'payment_method') {
                    state.data.paymentMethod = method;
                    state.step = 'image';
                    this.productHandler.productAddStates.set(userId, state);
                    
                    await this.bot.sendMessage(chatId,
                        `✅ Metode pembayaran: ${method === 'auto' ? '⚡ QRIS Otomatis' : method === 'manual' ? '📸 Manual' : '🔄 Kedua-duanya'}\n\n` +
                        `🖼️ *Step 6/7:* Upload gambar produk (optional)\n\n` +
                        `💡 *Tips:*\n` +
                        `• Gunakan gambar produk yang menarik\n` +
                        `• Format: JPG, PNG\n` +
                        `• Maksimal 10MB\n` +
                        `• Ketik "skip" untuk lewati\n\n` +
                        `📸 Silakan upload gambar produk atau ketik "skip":`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else if (data.startsWith('manual_pay_')) {
                await this.handleManualPaymentSelection(chatId, messageId, data, userId, query);
            } else if (data.startsWith('product_payment_')) {
                const paymentType = data.replace('product_payment_', '');
                const state = this.productAddStates.get(userId);

                if (!state || state.step !== 'payment_method') {
                    await this.bot.answerCallbackQuery(query.id, {
                        text: "❌ Session expired. Mulai lagi dengan /produk_add",
                        show_alert: true
                    });
                    return;
                }

                state.data.paymentMethod = paymentType;
                state.step = 'product_image';
                this.productAddStates.set(userId, state);

                await this.bot.editMessageText(
                    `✅ *Metode Pembayaran Dipilih*\n\n` +
                    `Metode: ${paymentType === 'auto' ? '⚡ QRIS Otomatis' : paymentType === 'manual' ? '📸 Manual' : '🔄 Kedua-duanya'}\n\n` +
                    `📸 *STEP 6/7: Upload Gambar Produk (Opsional)*\n\n` +
                    `Kirim gambar/foto produk untuk ditampilkan ke pembeli.\n` +
                    `Gambar akan muncul saat user melihat produk.\n\n` +
                    `💡 Upload sekarang atau ketik *skip* untuk lewati.`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }
                );
            } else if (handlers[data]) {
                await handlers[data]();
            } else if (data === 'page_info') {
                return;
            } else {
                console.log(`Unknown callback data: ${data}`);
                await this.bot.sendMessage(chatId, `❌ Command tidak dikenal: "${data}"\nSilakan /start ulang.`);
            }
        } catch (error) {
            console.error(`Callback error for data "${data}":`, error);
            await this.bot.sendMessage(chatId, 
                `❌ *Terjadi Masalah Sistem*\n\nSilakan ketik /start untuk memulai ulang.`,
                { parse_mode: 'Markdown' }
            );
        } finally {
            this.processingCallbacks.delete(callbackKey);
        }
    }

    async showServerSelection(chatId, messageId, userId, page = 0) {
        try {
            const providers = this.providerManager.getEnabledProviders();
            
            if (providers.length === 0) {
                const keyboard = {
                    inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
                };
                
                await editPhotoCaption(
                    this.bot, chatId, messageId, this.botLogo,
                    '❌ *Tidak Ada Server Aktif*\n\nSemua provider sedang maintenance.',
                    keyboard
                );
                return;
            }

            const ITEMS_PER_PAGE = 8;
            const totalPages = Math.ceil(providers.length / ITEMS_PER_PAGE);
            const startIndex = page * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const providersOnPage = providers.slice(startIndex, endIndex);

            const keyboard = {
                inline_keyboard: []
            };

            const grouped = {
                global: providersOnPage.filter(p => p.type === 'global'),
                indonesia: providersOnPage.filter(p => p.type === 'indonesia'),
                regional: providersOnPage.filter(p => p.type === 'regional'),
                premium: providersOnPage.filter(p => p.type === 'premium')
            };

            let serverNum = startIndex + 1;

            for (const [type, typeProviders] of Object.entries(grouped)) {
                if (typeProviders.length > 0) {
                    typeProviders.forEach(provider => {
                        const buttonText = `${provider.emoji} Server ${serverNum} - ${provider.name}`;
                        keyboard.inline_keyboard.push([{
                            text: buttonText,
                            callback_data: `select_server_${provider.key}`
                        }]);
                        serverNum++;
                    });
                }
            }

            const navButtons = [];
            if (page > 0) {
                navButtons.push({
                    text: '⬅️ Sebelumnya',
                    callback_data: `servers_page_${page - 1}`
                });
            }
            
            navButtons.push({
                text: `${page + 1}/${totalPages}`,
                callback_data: 'page_info'
            });
            
            if (page < totalPages - 1) {
                navButtons.push({
                    text: 'Berikutnya ➡️',
                    callback_data: `servers_page_${page + 1}`
                });
            }
            
            if (navButtons.length > 0) {
                keyboard.inline_keyboard.push(navButtons);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

            let headerText = `🌐 *PILIH SERVER* (Hal ${page + 1}/${totalPages})\n\n`;
            headerText += `Total ${providers.length} server tersedia:\n\n`;
            
            const typeCounts = {
                global: providers.filter(p => p.type === 'global').length,
                indonesia: providers.filter(p => p.type === 'indonesia').length,
                regional: providers.filter(p => p.type === 'regional').length,
                premium: providers.filter(p => p.type === 'premium').length
            };

            headerText += `🌍 Global: ${typeCounts.global}\n`;
            headerText += `🇮🇩 Indonesia: ${typeCounts.indonesia}\n`;
            headerText += `🌎 Regional: ${typeCounts.regional}\n`;
            headerText += `👑 Premium: ${typeCounts.premium}\n\n`;
            headerText += `💡 *Tips:*\n`;
            headerText += `• Server 1-10 = Paling stabil\n`;
            headerText += `• Indonesia = Harga lokal murah\n`;
            headerText += `• Premium = Kualitas terbaik\n\n`;
            headerText += `Pilih server untuk lanjut:`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, headerText, keyboard);

        } catch (error) {
            console.error('Show server selection error:', error);
            const errorKeyboard = {
                inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
            };
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, '❌ Error loading servers', errorKeyboard);
        }
    }

    async handleServerSelection(chatId, messageId, userId, serverKey) {
        try {
            const provider = this.providerManager.getProvider(serverKey);
            const providerConfig = this.config.PROVIDERS[serverKey];
            
            this.userProviders.set(userId, serverKey);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Lanjut ke Negara', callback_data: 'countries_page_0' }],
                    [{ text: '🔙 Pilih Server Lain', callback_data: 'buy_start' }]
                ]
            };

            const selectionText = `${providerConfig.emoji} *SERVER DIPILIH*\n\n` +
                `📡 Provider: *${providerConfig.name}*\n` +
                `🌐 Type: ${providerConfig.type.toUpperCase()}\n` +
                `📝 Deskripsi:\n${providerConfig.description}\n\n` +
                `⭐ Priority Level: ${providerConfig.priority}\n\n` +
                `✅ Server berhasil dipilih!\n` +
                `Klik "Lanjut ke Negara" untuk mulai order.`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, selectionText, keyboard);

        } catch (error) {
            console.error('Handle server selection error:', error);
            const errorKeyboard = {
                inline_keyboard: [[{ text: '🔙 Pilih Server', callback_data: 'buy_start' }]]
            };
            await editPhotoCaption(
                this.bot, chatId, messageId, this.botLogo, 
                '❌ *Server Tidak Tersedia*\n\nProvider sedang maintenance atau tidak aktif.',
                errorKeyboard
            );
        }
    }

    async showCountries(chatId, messageId, userId, page = 0) {
        try {
            const serverKey = this.userProviders.get(userId);
            
            if (!serverKey) {
                await editPhotoCaption(
                    this.bot, chatId, messageId, this.botLogo,
                    '❌ *Belum Pilih Server*\n\nSilakan pilih server terlebih dahulu.',
                    { inline_keyboard: [[{ text: '🌐 Pilih Server', callback_data: 'buy_start' }]] }
                );
                return;
            }

            const provider = this.providerManager.getProvider(serverKey);
            const providerConfig = this.config.PROVIDERS[serverKey];
            
            const countriesResult = await provider.getCountries();
            
            if (!countriesResult.success || !countriesResult.data || countriesResult.data.length === 0) {
                const errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔙 Pilih Server Lain', callback_data: 'buy_start' }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };

                await editPhotoCaption(
                    this.bot, chatId, messageId, this.botLogo,
                    `❌ *Gagal Mengambil Data Negara*\n\n` +
                    `📡 Server: ${providerConfig.name}\n` +
                    `🔴 Status: Tidak Ada Data\n\n` +
                    `Coba server lain atau hubungi admin.`,
                    errorKeyboard
                );
                return;
            }

            const countriesData = countriesResult.data;
            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(countriesData.length / ITEMS_PER_PAGE);
            const startIndex = page * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const countriesOnPage = countriesData.slice(startIndex, endIndex);

            const keyboard = {
                inline_keyboard: []
            };

            countriesOnPage.forEach(country => {
                keyboard.inline_keyboard.push([{
                    text: `🌍 ${country.name}`,
                    callback_data: `country_${country.id}_page_0`
                }]);
            });

            const navButtons = [];
            
            if (page > 0) {
                navButtons.push({
                    text: '⬅️ Sebelumnya',
                    callback_data: `countries_page_${page - 1}`
                });
            }
            
            navButtons.push({
                text: `${page + 1}/${totalPages}`,
                callback_data: 'page_info'
            });
            
            if (page < totalPages - 1) {
                navButtons.push({
                    text: 'Berikutnya ➡️',
                    callback_data: `countries_page_${page + 1}`
                });
            }
            
            if (navButtons.length > 0) {
                keyboard.inline_keyboard.push(navButtons);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Pilih Server', callback_data: 'buy_start' }]);

            const headerText = `🌍 *Pilih Negara* (Hal ${page + 1}/${totalPages})\n\n` +
                `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                `🌐 Total ${countriesData.length} negara tersedia.\n\n` +
                `Pilih negara untuk nomor SMS:`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, headerText, keyboard);

        } catch (error) {
            console.error('Show countries error:', error);
            const errorKeyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Pilih Server', callback_data: 'buy_start' }],
                    [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                ]
            };
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, '❌ Error loading countries', errorKeyboard);
        }
    }

    async showServices(chatId, messageId, data, userId) {
        try {
            const serverKey = this.userProviders.get(userId);
            
            if (!serverKey) {
                await editPhotoCaption(
                    this.bot, chatId, messageId, this.botLogo,
                    '❌ *Session Expired*\n\nSilakan mulai dari awal.',
                    { inline_keyboard: [[{ text: '🌐 Mulai Order', callback_data: 'buy_start' }]] }
                );
                return;
            }

            const provider = this.providerManager.getProvider(serverKey);
            const providerConfig = this.config.PROVIDERS[serverKey];

            const dataParts = data.replace('country_', '').split('_page_');
            const country = dataParts[0];
            const currentPage = parseInt(dataParts[1] || '0');
            
            const servicesResult = await provider.getServices(country);
            
            if (!servicesResult.success || !servicesResult.data || servicesResult.data.length === 0) {
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🔙 Pilih Negara', callback_data: 'countries_page_0' }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };
                
                await editPhotoCaption(
                    this.bot, chatId, messageId, this.botLogo,
                    `❌ *Stock Habis di ${country}*\n\n` +
                    `📡 Server: ${providerConfig.name}\n\n` +
                    `Silakan pilih negara lain atau coba lagi nanti.`,
                    keyboard
                );
                return;
            }

            const availableServices = servicesResult.data;
            
            const priorityServices = availableServices.sort((a, b) => {
                const getPriority = (service) => {
                    const name = service.name.toLowerCase();
                    if (name.includes('whatsapp')) return 1;
                    if (name.includes('viber')) return 2;
                    if (name.includes('telegram')) return 3;
                    if (name.includes('instagram')) return 4;
                    if (name.includes('facebook')) return 5;
                    return 999;
                };
                
                return getPriority(a) - getPriority(b);
            });

            const ITEMS_PER_PAGE = 8;
            const totalPages = Math.ceil(priorityServices.length / ITEMS_PER_PAGE);
            const startIndex = currentPage * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const servicesOnPage = priorityServices.slice(startIndex, endIndex);

            const keyboard = {
                inline_keyboard: []
            };

            servicesOnPage.forEach(service => {
                const price = parseInt(service.price) + this.config.MARKUP_PROFIT;
                const name = service.name.toLowerCase();
                
                let emoji = '📱';
                if (name.includes('whatsapp')) emoji = '🔥';
                else if (name.includes('viber')) emoji = '🔥';
                else if (name.includes('telegram')) emoji = '🔥';
                else if (name.includes('instagram')) emoji = '📸';
                else if (name.includes('facebook')) emoji = '📘';
                
                const text = `${emoji} ${service.name.toUpperCase()} - Rp ${price.toLocaleString('id-ID')} | Stok: ${service.stock}`;
                keyboard.inline_keyboard.push([{
                    text,
                    callback_data: `service_${service.id}_${country}_${price}_${service.name.replace(/\s/g, '_')}`
                }]);
            });

            const navButtons = [];
            
            if (currentPage > 0) {
                navButtons.push({
                    text: '⬅️ Sebelumnya',
                    callback_data: `country_${country}_page_${currentPage - 1}`
                });
            }
            
            navButtons.push({
                text: `${currentPage + 1}/${totalPages}`,
                callback_data: 'page_info'
            });
            
            if (currentPage < totalPages - 1) {
                navButtons.push({
                    text: 'Berikutnya ➡️',
                    callback_data: `country_${country}_page_${currentPage + 1}`
                });
            }
            
            if (navButtons.length > 0) {
                keyboard.inline_keyboard.push(navButtons);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Pilih Negara', callback_data: 'countries_page_0' }]);

            const headerText = `📱 *Layanan di ${country}* (Hal ${currentPage + 1}/${totalPages})\n\n` +
                `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                `🌐 Total ${priorityServices.length} layanan tersedia.\n` +
                `🔌 WhatsApp & Viber diprioritaskan di atas.\n\n` +
                `Pilih layanan yang dibutuhkan:`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, headerText, keyboard);

        } catch (error) {
            console.error('Show services error:', error);
            const errorKeyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Pilih Negara', callback_data: 'countries_page_0' }],
                    [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                ]
            };
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, '❌ Error loading services', errorKeyboard);
        }
    }

    async confirmPurchase(chatId, messageId, data, userId) {
        const dataParts = data.split('_');
        const serviceId = dataParts[1];
        const country = dataParts[2];
        const oldPrice = parseInt(dataParts[3]);
        const serviceName = dataParts.slice(4).join('_').replace(/_/g, ' ');
        
        const user = await this.getUser(userId);

        if (!user || user.saldo < oldPrice) {
            const currentSaldo = user ? user.saldo : 0;
            const keyboard = {
                inline_keyboard: [[{ text: '💳 Top Up Saldo', callback_data: 'topup' }]]
            };
    
            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                `❌ *Saldo Tidak Cukup*\n\n` +
                `Saldo Anda: Rp ${currentSaldo.toLocaleString('id-ID')}\n` +
                `Dibutuhkan: Rp ${oldPrice.toLocaleString('id-ID')}\n` +
                `Kurang: Rp ${(oldPrice - currentSaldo).toLocaleString('id-ID')}`,
                keyboard
            );
            return;
        }

        const serverKey = this.userProviders.get(userId);
        const providerConfig = serverKey ? this.config.PROVIDERS[serverKey] : null;

        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Beli Sekarang', callback_data: `buy_confirm_${serviceId}_${country}_${oldPrice}_${serviceName.replace(/\s/g, '_')}` }],
                [{ text: '🔙 Kembali', callback_data: `country_${country}_page_0` }]
            ]
        };

        const confirmText = `📱 *Konfirmasi Pembelian*\n\n` +
            `📡 Server: ${providerConfig ? providerConfig.emoji + ' ' + providerConfig.name : 'Unknown'}\n` +
            `📧 Layanan: ${serviceName}\n` +
            `🌍 Negara: ${country}\n` +
            `💰 Harga: Rp ${oldPrice.toLocaleString('id-ID')}\n` +
            `💳 Saldo Anda: Rp ${user.saldo.toLocaleString('id-ID')}\n\n` +
            `🤖 *Proses Otomatis:*\n` +
            `✅ Dapat nomor langsung\n` +
            `✅ SMS masuk otomatis dikirim\n` +
            `✅ Refund jika gagal dalam 5 menit\n\n` +
            `Lanjutkan pembelian?`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, confirmText, keyboard);
    }

    async processPurchase(chatId, messageId, data, userId) {
        const dataParts = data.replace('buy_confirm_', '').split('_');
        const serviceId = dataParts[0];
        const country = dataParts[1];
        const oldPrice = parseInt(dataParts[2]);
        const serviceName = dataParts.slice(3).join('_').replace(/_/g, ' ');

        const serverKey = this.userProviders.get(userId);
        
        if (!serverKey) {
            await editPhotoCaption(
                this.bot, chatId, messageId, this.botLogo,
                '❌ *Session Expired*\n\nSilakan mulai order dari awal.',
                { inline_keyboard: [[{ text: '🌐 Mulai Order', callback_data: 'buy_start' }]] }
            );
            return;
        }

        const provider = this.providerManager.getProvider(serverKey);
        const providerConfig = this.config.PROVIDERS[serverKey];

        const orders = await this.db.loadOrders();
        if (orders[userId]) {
            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                '❌ Anda masih memiliki pesanan aktif. Selesaikan dulu atau batalkan.',
                { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }  
            );
            return;
        }

        const processingKey = `processing_${userId}`;
        if (this.pendingOrders.has(processingKey)) {
            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                '⏳ Pesanan Anda sedang diproses. Harap tunggu...',
                { inline_keyboard: [] }
            );
            return;
        }

        this.pendingOrders.add(processingKey);

        try {
            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                `⏳ Mengecek harga terbaru...\n\n📡 Server: ${providerConfig.name}\n\nHarap tunggu, jangan tekan apapun.`,
                { inline_keyboard: [] }
            );

            const servicesResult = await provider.getServices(country);
            
            if (!servicesResult.success || !servicesResult.data) {
                this.pendingOrders.delete(processingKey);
                const errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: `country_${country}_page_0` }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ Gagal mengecek harga terbaru. Coba lagi.',
                    errorKeyboard
                );
                return;
            }

            const service = servicesResult.data.find(s => s.id === serviceId);
            
            if (!service || service.stock <= 0) {
                this.pendingOrders.delete(processingKey);
                const errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔙 Pilih Layanan Lain', callback_data: `country_${country}_page_0` }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ Stock habis untuk layanan ini. Pilih layanan lain.',
                    errorKeyboard
                );
                return;
            }

            const finalPrice = parseInt(service.price) + this.config.MARKUP_PROFIT;

            if (finalPrice > oldPrice) {
                this.pendingOrders.delete(processingKey);
                const priceChangeKeyboard = {
                    inline_keyboard: [
                        [{ text: `✅ Lanjut Bayar Rp ${finalPrice.toLocaleString('id-ID')}`, 
                          callback_data: `buy_confirm_${serviceId}_${country}_${finalPrice}_${serviceName.replace(/\s/g, '_')}` }],
                        [{ text: '🔙 Batal', callback_data: `country_${country}_page_0` }]
                    ]
                };
                
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    `⚠️ *HARGA BERUBAH!*\n\n` +
                    `📧 Layanan: ${serviceName}\n` +
                    `💰 Harga Lama: Rp ${oldPrice.toLocaleString('id-ID')}\n` +
                    `💰 Harga Baru: Rp ${finalPrice.toLocaleString('id-ID')}\n` +
                    `📈 Naik: Rp ${(finalPrice - oldPrice).toLocaleString('id-ID')}\n\n` +
                    `Harga dari provider naik. Lanjutkan?`,
                    priceChangeKeyboard
                );
                return;
            }

            const user = await this.getUser(userId);
            if (!user || user.saldo < finalPrice) {
                this.pendingOrders.delete(processingKey);
                const currentSaldo = user ? user.saldo : 0;
                const keyboard = {
                    inline_keyboard: [[{ text: '💳 Top Up Saldo', callback_data: 'topup' }]]
                };
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    `❌ *Saldo Tidak Cukup*\n\n` +
                    `Saldo Anda: Rp ${currentSaldo.toLocaleString('id-ID')}\n` +
                    `Dibutuhkan: Rp ${finalPrice.toLocaleString('id-ID')}\n` +
                    `Kurang: Rp ${(finalPrice - currentSaldo).toLocaleString('id-ID')}`,
                    keyboard
                );
                return;
            }

            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                `⏳ Sedang memproses pembelian...\n\n📡 Server: ${providerConfig.name}\n\nHarap tunggu, jangan tekan apapun.`,
                { inline_keyboard: [] }
            );

            const orderResponse = await provider.orderNumber(serviceId, country);

            if (!orderResponse.success || !orderResponse.data) {
                this.pendingOrders.delete(processingKey);
                
                const errorInfo = orderResponse.error || 'Unknown error';
                
                const errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: `country_${country}_page_0` }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };

                let errorText = `❌ *Order ERROR*\n💳 Saldo Tidak Dikurangi\n\n`;
                errorText += `📡 Server: ${providerConfig.name}\n`;
                errorText += `📄 *Respon Error:*\n${errorInfo}\n\n`;
                errorText += `💡 *Solusi:*\nCoba layanan lain atau hubungi admin.`;

                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    errorText,
                    errorKeyboard
                );
                return;
            }

            const { id: orderId, number } = orderResponse.data;

            const users = await this.db.loadUsers();
            const userIndex = users.findIndex(u => u.id === userId.toString());
            
            if (userIndex === -1) {
                await provider.cancelOrder(orderId);
                this.pendingOrders.delete(processingKey);
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    `❌ User tidak ditemukan saat potong saldo.`,
                    { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
                );
                return;
            }

            if (users[userIndex].saldo < finalPrice) {
                await provider.cancelOrder(orderId);
                this.pendingOrders.delete(processingKey);
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    `❌ Saldo tidak mencukupi saat pembelian.`,
                    { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]] }
                );
                return;
            }

            users[userIndex].saldo -= finalPrice;
            users[userIndex].date = this.getIndonesianTimestamp();
            await this.db.saveUsers(users);

            const currentOrders = await this.db.loadOrders();
            currentOrders[userId] = {
                orderId,
                number,
                price: finalPrice,
                country,
                serviceId,
                serviceName,
                timestamp: Date.now(),
                chatId,
                messageId,
                status: 'active',
                userName: await this.getUserName(userId),
                providerKey: serverKey
            };
            await this.db.saveOrders(currentOrders);

            setTimeout(async () => {
                await provider.setStatus(orderId, '1');
            }, 3000);

            this.pendingOrders.delete(processingKey);

            const orderText = `📱 *Order Berhasil!*\n\n` +
                `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                `📱 Nomor: +${number}\n` +
                `📧 Layanan: ${serviceName}\n` +
                `🌍 Negara: ${country}\n` +
                `💰 Harga: Rp ${finalPrice.toLocaleString('id-ID')}\n` +
                `🆔 ID: ${orderId}\n\n` +
                `📂 *Langkah Selanjutnya:*\n` +
                `• Gunakan nomor untuk registrasi\n` +
                `• Minta kode OTP\n` +
                `• SMS akan dikirim otomatis\n` +
                `• Jika 5 menit tidak ada SMS = refund otomatis\n\n` +
                `⏰ Menunggu SMS masuk...\n\n` +
                `💡 *Button cancel akan muncul dalam 5 menit*`;

            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                orderText,
                { inline_keyboard: [] }
            );

            this.startSMSMonitoring(userId, orderId, serverKey);

            setTimeout(async () => {
                try {
                    const currentOrders = await this.db.loadOrders();
                    if (currentOrders[userId] && currentOrders[userId].status === 'active') {
                        const keyboard = {
                            inline_keyboard: [[{ text: '❌ Batalkan Order', callback_data: `cancel_${orderId}` }]]
                        };

                        const updatedText = `📱 *Order Berhasil!*\n\n` +
                            `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                            `📱 Nomor: +${number}\n` +
                            `📧 Layanan: ${serviceName}\n` +
                            `🌍 Negara: ${country}\n` +
                            `💰 Harga: Rp ${finalPrice.toLocaleString('id-ID')}\n` +
                            `🆔 ID: ${orderId}\n\n` +
                            `📂 *Langkah Selanjutnya:*\n` +
                            `• Gunakan nomor untuk registrasi\n` +
                            `• Minta kode OTP\n` +
                            `• SMS akan dikirim otomatis\n` +
                            `• Auto refund jika tidak ada SMS dalam 3 menit lagi\n\n` +
                            `⏰ Menunggu SMS masuk...\n` +
                            `✅ Button cancel sudah tersedia`;

                        await editPhotoCaption(
                            this.bot,
                            chatId,
                            messageId,
                            this.botLogo,
                            updatedText,
                            keyboard
                        );
                    }
                } catch (error) {
                    console.log('Error showing cancel button:', error.message);
                }
            }, 300000);

        } catch (error) {
            this.pendingOrders.delete(processingKey);
            console.error('Purchase error:', error);
            
            const errorKeyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: `country_${country}_page_0` }],
                    [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                ]
            };

            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                '❌ *Terjadi Kesalahan Sistem*\n\n💳 Saldo Tidak Dikurangi\n\nSilakan coba lagi atau hubungi admin.',
                errorKeyboard
            );
        }
    }

    async startSMSMonitoring(userId, orderId, serverKey) {
        let attempt = 0;
        const maxAttempts = this.config.MAX_CHECK_ATTEMPTS;
        const provider = this.providerManager.getProvider(serverKey);

        if (this.activeMonitors.has(userId)) {
            clearInterval(this.activeMonitors.get(userId));
        }

        const monitor = setInterval(async () => {
            attempt++;

            try {
                const orders = await this.db.loadOrders();
                if (!orders[userId] || orders[userId].orderId !== orderId || orders[userId].status !== 'active') {
                    clearInterval(monitor);
                    this.activeMonitors.delete(userId);
                    return;
                }

                const orderData = orders[userId];
                const statusResponse = await provider.getStatus(orderId);

                if (statusResponse?.success && statusResponse.data?.status === 'Success' && statusResponse.data?.sms) {
                    const smsCode = statusResponse.data.sms;

                    const currentOrders = await this.db.loadOrders();
                    if (currentOrders[userId] && currentOrders[userId].status === 'active') {
                        currentOrders[userId].status = 'completed';
                        await this.db.saveOrders(currentOrders);
                        
                        await provider.setStatus(orderId, '4');

                        await this.addToHistory(userId, currentOrders[userId], smsCode);

                        delete currentOrders[userId];
                        await this.db.saveOrders(currentOrders);

                        clearInterval(monitor);
                        this.activeMonitors.delete(userId);

                        const keyboard = {
                            inline_keyboard: [[{ text: '📱 Beli Lagi', callback_data: 'buy_start' }]]
                        };

                        const timeInfo = this.getIndonesianTime();
                        const providerConfig = this.config.PROVIDERS[serverKey];

                        const successText = `📨 *SMS Berhasil Diterima!*\n\n` +
                            `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                            `🔑 Kode OTP: *${smsCode}*\n` +
                            `📱 Nomor: +${orderData.number}\n` +
                            `📧 Layanan: ${orderData.serviceName}\n` +
                            `📅 Tanggal: ${timeInfo.date}\n` +
                            `🕐 Jam: ${timeInfo.time}\n\n` +
                            `✅ Transaksi selesai!\n` +
                            `📜 Order disimpan di riwayat.`;

                        await editPhotoCaption(
                            this.bot,
                            orderData.chatId,
                            orderData.messageId,
                            this.botLogo,
                            successText,
                            keyboard
                        );

                        await this.sendTestimoniToChannel(orderData, smsCode);
                    }
                    return;
                }

                if (attempt >= maxAttempts) {
                    clearInterval(monitor);
                    this.activeMonitors.delete(userId);
                    await this.autoRefund(userId, orderId, serverKey);
                }

            } catch (error) {
                console.error('SMS Monitor error:', error);
            }
        }, 15000);

        this.activeMonitors.set(userId, monitor);
    }

    async autoRefund(userId, orderId, serverKey) {
        const refundKey = `refund_${userId}_${orderId}`;
        
        if (this.refundLocks.has(refundKey)) {
            console.log(`Refund already processed for ${userId}-${orderId}`);
            return;
        }
        
        this.refundLocks.add(refundKey);
        
        try {
            if (this.activeMonitors.has(userId)) {
                clearInterval(this.activeMonitors.get(userId));
                this.activeMonitors.delete(userId);
            }

            const provider = this.providerManager.getProvider(serverKey);
            await provider.cancelOrder(orderId);

            const orders = await this.db.loadOrders();
            if (orders[userId] && orders[userId].orderId === orderId) {
                const orderData = orders[userId];

                const refundResult = await this.updateUserSaldo(userId, orderData.price, 'add');
                
                if (refundResult.success) {
                    delete orders[userId];
                    await this.db.saveOrders(orders);
                    
                    const providerConfig = this.config.PROVIDERS[serverKey];
                    const keyboard = {
                        inline_keyboard: [[{ text: '📱 Coba Lagi', callback_data: 'buy_start' }]]
                    };

                    const refundText = `⏰ *Timeout - SMS Tidak Masuk*\n\n` +
                        `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                        `💰 Saldo Rp ${orderData.price.toLocaleString('id-ID')} telah dikembalikan\n` +
                        `💳 Saldo total: Rp ${refundResult.newSaldo.toLocaleString('id-ID')}\n` +
                        `🆔 Order ID: ${orderId}\n\n` +
                        `Silakan coba layanan lain atau coba lagi nanti.`;

                    await editPhotoCaption(
                        this.bot,
                        orderData.chatId,
                        orderData.messageId,
                        this.botLogo,
                        refundText,
                        keyboard
                    );
                }
            }
        } catch (error) {
            console.error('Auto refund error:', error);
        } finally {
            setTimeout(() => {
                this.refundLocks.delete(refundKey);
            }, 5000);
        }
    }

    async cancelOrder(chatId, messageId, data, userId) {
        const orderId = data.replace('cancel_', '');
        const refundKey = `refund_${userId}_${orderId}`;
        
        if (this.refundLocks.has(refundKey)) {
            await this.bot.editMessageText('❌ *Sedang Memproses Pembatalan*\n\nHarap tunggu, sistem sedang membatalkan order Anda...', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });
            return;
        }

        const orders = await this.db.loadOrders();
        if (!orders[userId] || orders[userId].orderId !== orderId) {
            const keyboard = {
                inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]]
            };

            await this.bot.editMessageText('❌ *Order Tidak Ditemukan*\n\nOrder mungkin sudah selesai atau dibatalkan.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
            return;
        }

        const orderData = orders[userId];
        const orderTime = orderData.timestamp;
        const elapsed = Date.now() - orderTime;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        
        if (elapsedMinutes < 5) {
            const remainingTime = 5 - elapsedMinutes;
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'active_orders' }],
                    [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                ]
            };

            await this.bot.editMessageText(
                `⏰ *Belum Bisa Dibatalkan*\n\n` +
                `Provider membutuhkan minimal 5 menit untuk memproses cancel.\n\n` +
                `⏳ Sisa waktu: ${remainingTime} menit\n` +
                `📱 Nomor: +${orderData.number}\n` +
                `💰 Harga: Rp ${orderData.price.toLocaleString('id-ID')}\n\n` +
                `🤖 *Auto cancel akan berjalan jika SMS tidak masuk dalam 3 menit lagi.*`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                }
            );
            return;
        }
        
        this.refundLocks.add(refundKey);
        
        try {
            await this.bot.editMessageText('⏳ *Membatalkan Order...*\n\nSedang memproses pembatalan, harap tunggu...', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });

            if (this.activeMonitors.has(userId)) {
                clearInterval(this.activeMonitors.get(userId));
                this.activeMonitors.delete(userId);
            }

            orderData.status = 'cancelling';
            orders[userId] = orderData;
            await this.db.saveOrders(orders);

            const serverKey = orderData.providerKey;
            const provider = this.providerManager.getProvider(serverKey);
            const providerConfig = this.config.PROVIDERS[serverKey];

            let cancelSuccess = false;
            let attempts = 0;
            const maxRetries = 3;

            while (!cancelSuccess && attempts < maxRetries) {
                attempts++;
                console.log(`Cancel attempt ${attempts} for order ${orderId} on ${providerConfig.name}`);
                
                try {
                    const cancelResponse = await provider.cancelOrder(orderId);
                    
                    if (cancelResponse && cancelResponse.success) {
                        cancelSuccess = true;
                        console.log(`✅ Cancel berhasil untuk order ${orderId}`);
                    } else {
                        console.log(`❌ Cancel attempt ${attempts} gagal`);
                        if (attempts < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                } catch (error) {
                    console.log(`❌ Cancel attempt ${attempts} error:`, error.message);
                    if (attempts < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            const refundResult = await this.updateUserSaldo(userId, orderData.price, 'add');
            
            if (refundResult.success) {
                const currentOrders = await this.db.loadOrders();
                if (currentOrders[userId]) {
                    delete currentOrders[userId];
                    await this.db.saveOrders(currentOrders);
                }

                const keyboard = {
                    inline_keyboard: [[{ text: '📱 Beli Lagi', callback_data: 'buy_start' }]]
                };

                const successMsg = cancelSuccess ? 
                    'âœ… Berhasil dibatalkan di provider' : 
                    '⚠️ Cancel API timeout, tapi saldo tetap dikembalikan';

                const cancelText = `❌ *Order Dibatalkan*\n\n` +
                    `📡 Server: ${providerConfig.emoji} ${providerConfig.name}\n` +
                    `💰 Saldo Rp ${orderData.price.toLocaleString('id-ID')} telah dikembalikan\n` +
                    `💳 Saldo total: Rp ${refundResult.newSaldo.toLocaleString('id-ID')}\n\n` +
                    `📝 Status: ${successMsg}\n\n` +
                    `Terima kasih!`;

                await this.bot.editMessageText(cancelText, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            } else {
                orderData.status = 'active';
                orders[userId] = orderData;
                await this.db.saveOrders(orders);

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 Coba Lagi', callback_data: `cancel_${orderId}` }],
                        [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                    ]
                };

                await this.bot.editMessageText(`❌ *Gagal Refund Saldo*\n\n${refundResult.message}\n\nSilakan coba lagi.`, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            }

        } catch (error) {
            console.error('Cancel order error:', error);
            
            const currentOrders = await this.db.loadOrders();
            if (currentOrders[userId]) {
                currentOrders[userId].status = 'active';
                await this.db.saveOrders(currentOrders);
            }

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Coba Lagi', callback_data: `cancel_${orderId}` }],
                    [{ text: '🏠 Menu Utama', callback_data: 'back_main' }]
                ]
            };

            await this.bot.editMessageText('❌ *Error Sistem*\n\nTerjadi kesalahan saat membatalkan. Coba lagi.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });

        } finally {
            setTimeout(() => {
                this.refundLocks.delete(refundKey);
            }, 10000);
        }
    }

    async handlePhotoUpload(msg) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        const productState = this.productAddStates.get(userId);
        if (productState && productState.step === 'product_image') {
            try {
                const photo = msg.photo[msg.photo.length - 1];
                const fileId = photo.file_id;
                
                productState.data.productImage = {
                    fileId: fileId,
                    fileSize: photo.file_size
                };
                productState.step = 'product_data';
                this.productAddStates.set(userId, productState);
                
                await this.bot.sendMessage(chatId,
                    `✅ *Gambar produk tersimpan!*\n\n` +
                    `📦 *STEP 7/7: Upload Data Produk*\n\n` +
                    `Silakan upload data produk yang akan dikirim ke pembeli:\n\n` +
                    `📝 *Format yang diterima:*\n` +
                    `1️⃣ **Text** - ketik langsung (email:password, link, dll)\n` +
                    `2️⃣ **File** - upload file (.txt, .pdf, .docx, dll)\n` +
                    `3️⃣ **Link** - kirim link Google Drive, Mega, dll\n\n` +
                    `💡 *Contoh:*\n` +
                    `\`email@gmail.com:password123\`\n` +
                    `atau upload file TXT/PDF\n\n` +
                    `Ketik atau upload sekarang:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            } catch (error) {
                console.error('Product image upload error:', error);
                await this.bot.sendMessage(chatId, '❌ Gagal upload gambar. Coba lagi.');
                return;
            }
        }

        const paymentState = this.paymentProofStates.get(userId);
        
        if (!paymentState) {
            return;
        }

        try {
            const photo = msg.photo[msg.photo.length - 1];
            const fileId = photo.file_id;

            paymentState.proofFileId = fileId;
            paymentState.proofUploadedAt = this.getIndonesianTimestamp();
            this.paymentProofStates.set(userId, paymentState);

            await this.bot.sendMessage(chatId,
                `✅ *Bukti Pembayaran Diterima!*\n\n` +
                `📸 Foto bukti telah diterima.\n` +
                `⏰ Menunggu verifikasi dari owner...\n\n` +
                `🔔 Anda akan mendapat notifikasi setelah owner memverifikasi.\n` +
                `⏱️ Proses verifikasi: 5-30 menit (tergantung owner online)`,
                { parse_mode: 'Markdown' }
            );

            const productOrders = await this.db.loadProductOrders();
            const order = productOrders.find(o => o.orderId === paymentState.orderId);

            if (order) {
                const products = await this.db.loadProducts();
                const product = products.find(p => p.id === order.productId);

                const approvalKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ APPROVE', callback_data: `appr_prod_${paymentState.orderId}` },
                            { text: '❌ REJECT', callback_data: `rej_prod_${paymentState.orderId}` }
                        ]
                    ]
                };

                await this.bot.sendPhoto(this.config.OWNER_ID, fileId, {
                    caption: 
                        `📸 *BUKTI PEMBAYARAN BARU*\n\n` +
                        `🆔 Order ID: \`${order.orderId}\`\n` +
                        `👤 User ID: \`${userId}\`\n` +
                        `📱 Username: @${order.username}\n` +
                        `📦 Produk: ${product ? product.name : 'N/A'}\n` +
                        `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n` +
                        `📅 Upload: ${paymentState.proofUploadedAt}\n\n` +
                        `⬆️ *Bukti pembayaran di atas*\n\n` +
                        `Approve atau Reject?`,
                    parse_mode: 'Markdown',
                    reply_markup: approvalKeyboard
                });

                this.paymentProofStates.delete(userId);

                console.log(`✅ Payment proof forwarded to owner for order ${order.orderId}`);
            }

        } catch (error) {
            console.error('Handle photo upload error:', error);
            await this.bot.sendMessage(chatId,
                `❌ *Gagal Upload Bukti*\n\n` +
                `Terjadi kesalahan saat upload. Silakan coba lagi atau hubungi admin.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleDocumentUpload(msg) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        const state = this.productAddStates.get(userId);
        
        if (!state || state.step !== 'product_data') {
            return;
        }

        try {
            const document = msg.document;
            const fileId = document.file_id;
            const fileName = document.file_name;
            const fileSize = document.file_size;

            if (fileSize > 20 * 1024 * 1024) {
                return this.bot.sendMessage(chatId,
                    `❌ File terlalu besar! Max 20MB.\n` +
                    `Ukuran file Anda: ${(fileSize / 1024 / 1024).toFixed(2)} MB`,
                    { parse_mode: 'Markdown' }
                );
            }

            const products = await this.db.loadProducts();
            const productId = `PROD-${Date.now()}`;
            
            const paymentMethodText = state.data.paymentMethod === 'auto' ? '⚡ QRIS Otomatis' : 
                                     state.data.paymentMethod === 'manual' ? '📸 Manual' : '🔄 Kedua-duanya';

            const newProduct = {
                id: productId,
                name: state.data.name,
                description: state.data.description,
                price: state.data.price,
                stock: state.data.stock,
                paymentMethod: state.data.paymentMethod,
                productData: {
                    type: 'file',
                    fileId: fileId,
                    fileName: fileName,
                    fileSize: fileSize
                },
                productImage: state.data.productImage || null,
                createdAt: this.getIndonesianTimestamp(),
                createdBy: userId
            };

            products.push(newProduct);
            await this.db.saveProducts(products);

            this.productAddStates.delete(userId);

            await this.bot.sendMessage(chatId,
                `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
                `📦 Nama: ${newProduct.name}\n` +
                `📝 Deskripsi: ${newProduct.description}\n` +
                `💰 Harga: Rp ${newProduct.price.toLocaleString('id-ID')}\n` +
                `📦 Stock: ${newProduct.stock}\n` +
                `💳 Metode: ${paymentMethodText}\n` +
                `📄 Data: File (${fileName})\n` +
                `🆔 ID: \`${productId}\`\n\n` +
                `Produk sudah aktif dan bisa dibeli user!`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Handle document upload error:', error);
            await this.bot.sendMessage(chatId,
                `❌ Gagal upload file. Coba lagi atau ketik text manual.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleBroadcast(msg, match) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;

        if (senderId !== this.config.OWNER_ID) {
            console.log(`⚠️ Unauthorized broadcast attempt from user ${senderId}`);
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        const broadcastText = match[1];
        
        if (!broadcastText || broadcastText.trim().length === 0) {
            return this.bot.sendMessage(chatId, 
                "❌ *Format Salah*\n\n" +
                "**Teks Only:** `/bc Teks panjang bisa multi line`\n" +
                "**Foto + Caption:** Upload foto dengan caption `/bc Caption text`", 
                { parse_mode: 'Markdown' }
            );
        }

        const sanitizedText = broadcastText.replace(/[<>]/g, '');

        try {
            const users = await this.loadUniqueUsers();
            
            if (users.length === 0) {
                return this.bot.sendMessage(chatId, 
                    "❌ *Tidak Ada User*\n\nBelum ada user yang /start bot.", 
                    { parse_mode: 'Markdown' }
                );
            }

            console.log(`📡 Owner ${senderId} starting broadcast to ${users.length} users`);

            if (msg.photo && msg.photo.length > 0) {
                await this.broadcastWithPhoto(chatId, msg, sanitizedText, users);
            } else {
                await this.broadcastTextOnly(chatId, sanitizedText, users);
            }

        } catch (error) {
            console.error('Broadcast error:', error);
            await this.bot.sendMessage(chatId, 
                "❌ *Error Sistem*\n\nTerjadi kesalahan saat broadcast.", 
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handlePhotoBroadcast(msg) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        const broadcastText = msg.caption.replace('/bc ', '');
        
        if (!broadcastText || broadcastText.trim().length === 0) {
            return this.bot.sendMessage(chatId, 
                "❌ *Format Salah*\n\nCaption tidak boleh kosong.", 
                { parse_mode: 'Markdown' }
            );
        }

        const sanitizedText = broadcastText.replace(/[<>]/g, '');

        try {
            const users = await this.loadUniqueUsers();
            
            if (users.length === 0) {
                return this.bot.sendMessage(chatId, 
                    "❌ *Tidak Ada User*\n\nBelum ada user yang /start bot.", 
                    { parse_mode: 'Markdown' }
                );
            }

            await this.broadcastWithPhoto(chatId, msg, sanitizedText, users);

        } catch (error) {
            console.error('Photo broadcast error:', error);
            await this.bot.sendMessage(chatId, 
                "❌ *Error Sistem*\n\nTerjadi kesalahan saat broadcast.", 
                { parse_mode: 'Markdown' }
            );
        }
    }

    async broadcastTextOnly(chatId, text, users) {
        let successCount = 0;
        let failCount = 0;
        const totalUsers = users.length;

        const progressMsg = await this.bot.sendMessage(chatId, 
            `📡 *Broadcasting Text...*\n\n` +
            `📊 Target: ${totalUsers} users\n` +
            `✅ Berhasil: 0\n` +
            `❌ Gagal: 0\n` +
            `⏳ Progress: 0%`,
            { parse_mode: 'Markdown' }
        );

        for (let i = 0; i < users.length; i++) {
            const userId = users[i];
            
            if (userId < 0 && Math.abs(userId) > 1000000000000) {
                failCount++;
                continue;
            }
            
            try {
                await this.bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
                successCount++;
            } catch (error) {
                failCount++;
            }

            if ((i + 1) % 10 === 0 || i === users.length - 1) {
                const progress = Math.round(((i + 1) / totalUsers) * 100);
                
                try {
                    await this.bot.editMessageText(
                        `📡 *Broadcasting Text...*\n\n` +
                        `📊 Target: ${totalUsers} users\n` +
                        `✅ Berhasil: ${successCount}\n` +
                        `❌ Gagal: ${failCount}\n` +
                        `⏳ Progress: ${progress}%`,
                        {
                            chat_id: chatId,
                            message_id: progressMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                } catch (editError) {
                }
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const timeInfo = this.getIndonesianTime();
        const finalText = `✅ *Broadcast Selesai!*\n\n` +
            `📊 **Laporan:**\n` +
            `👥 Total Target: ${totalUsers}\n` +
            `✅ Berhasil Terkirim: ${successCount}\n` +
            `❌ Gagal Terkirim: ${failCount}\n` +
            `📈 Success Rate: ${Math.round((successCount/totalUsers)*100)}%\n\n` +
            `📅 Tanggal: ${timeInfo.date}\n` +
            `🕐 Jam: ${timeInfo.time}`;

        await this.bot.editMessageText(finalText, {
            chat_id: chatId,
            message_id: progressMsg.message_id,
            parse_mode: 'Markdown'
        });
    }

    async broadcastWithPhoto(chatId, originalMsg, caption, users) {
        let successCount = 0;
        let failCount = 0;
        const totalUsers = users.length;

        const photos = originalMsg.photo;
        const largestPhoto = photos[photos.length - 1];
        const photoId = largestPhoto.file_id;

        const progressMsg = await this.bot.sendMessage(chatId, 
            `📡 *Broadcasting Photo + Caption...*\n\n` +
            `📊 Target: ${totalUsers} users\n` +
            `✅ Berhasil: 0\n` +
            `❌ Gagal: 0\n` +
            `⏳ Progress: 0%`,
            { parse_mode: 'Markdown' }
        );

        for (let i = 0; i < users.length; i++) {
            const userId = users[i];
            
            if (userId < 0 && Math.abs(userId) > 1000000000000) {
                failCount++;
                continue;
            }
            
            try {
                await this.bot.sendPhoto(userId, photoId, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
                successCount++;
            } catch (error) {
                failCount++;
            }

            if ((i + 1) % 5 === 0 || i === users.length - 1) {
                const progress = Math.round(((i + 1) / totalUsers) * 100);
                
                try {
                    await this.bot.editMessageText(
                        `📡 *Broadcasting Photo + Caption...*\n\n` +
                        `📊 Target: ${totalUsers} users\n` +
                        `✅ Berhasil: ${successCount}\n` +
                        `❌ Gagal: ${failCount}\n` +
                        `⏳ Progress: ${progress}%`,
                        {
                            chat_id: chatId,
                            message_id: progressMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                } catch (editError) {
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const finalText = `✅ *Broadcast Foto Selesai!*\n\n` +
            `📊 **Laporan:**\n` +
            `👥 Total Target: ${totalUsers}\n` +
            `✅ Berhasil Terkirim: ${successCount}\n` +
            `❌ Gagal Terkirim: ${failCount}\n` +
            `📈 Success Rate: ${Math.round((successCount/totalUsers)*100)}%\n\n` +
            `🕐 Waktu: ${new Date().toLocaleString('id-ID')}`;

        await this.bot.editMessageText(finalText, {
            chat_id: chatId,
            message_id: progressMsg.message_id,
            parse_mode: 'Markdown'
        });
    }

    async handleReffCommand(msg, match) {
        const senderId = msg.from.id;
        const targetUserId = match[1];
        const amount = parseInt(match[2]);

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(msg.chat.id, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        if (!amount || amount < 100) {
            return this.bot.sendMessage(msg.chat.id, 
                "❌ *Invalid Amount*\n\nMinimal Rp 100\nContoh: `/reff 123456789 5000`", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const timestamp = this.getIndonesianTimestamp();
            const users = await this.db.loadUsers();
            const userIndex = users.findIndex(user => user.id === targetUserId.toString());
            
            if (userIndex !== -1) {
                const oldSaldo = users[userIndex].saldo;
                users[userIndex].saldo += amount;
                users[userIndex].date = timestamp;
                
                await this.db.saveUsers(users);

                const ownerText = `✅ *Reffund Berhasil!*\n\n` +
                    `👤 Target User ID: \`${targetUserId}\`\n` +
                    `💰 Jumlah: Rp ${amount.toLocaleString('id-ID')}\n` +
                    `📊 Saldo Lama: Rp ${oldSaldo.toLocaleString('id-ID')}\n` +
                    `📊 Saldo Baru: Rp ${users[userIndex].saldo.toLocaleString('id-ID')}\n` +
                    `📅 Waktu: ${timestamp}`;

                await this.bot.sendMessage(msg.chat.id, ownerText, { parse_mode: 'Markdown' });

            } else {
                const newUser = {
                    id: targetUserId.toString(),
                    saldo: amount,
                    date: timestamp
                };
                users.push(newUser);
                await this.db.saveUsers(users);

                const ownerText = `✅ *Reffund Berhasil! (User Baru)*\n\n` +
                    `👤 Target User ID: \`${targetUserId}\`\n` +
                    `💰 Jumlah: Rp ${amount.toLocaleString('id-ID')}\n` +
                    `📊 Saldo: Rp ${amount.toLocaleString('id-ID')}\n` +
                    `📅 Waktu: ${timestamp}`;

                await this.bot.sendMessage(msg.chat.id, ownerText, { parse_mode: 'Markdown' });
            }

            try {
                const userText = `🎉 *Selamat! Saldo Anda Bertambah*\n\n` +
                    `💰 Anda mendapat saldo Rp ${amount.toLocaleString('id-ID')}\n` +
                    `💳 Saldo total: Rp ${users.find(u => u.id === targetUserId.toString()).saldo.toLocaleString('id-ID')}\n\n` +
                    `🎁 Dari: Admin Bot\n` +
                    `📅 Waktu: ${timestamp}\n\n` +
                    `Gunakan saldo untuk beli nomor SMS!`;

                await this.bot.sendMessage(targetUserId, userText, { parse_mode: 'Markdown' });
                
                await this.bot.sendMessage(msg.chat.id, 
                    `📨 Notifikasi berhasil dikirim ke user ${targetUserId}`
                );
            } catch (notifError) {
                await this.bot.sendMessage(msg.chat.id, 
                    `⚠️ Saldo berhasil ditambah, tapi gagal kirim notifikasi ke user`
                );
            }

        } catch (error) {
            console.error('Referral command error:', error);
            await this.bot.sendMessage(msg.chat.id, 
                "❌ *System Error*\n\nTerjadi kesalahan saat memproses referral."
            );
        }
    }

    async handleDepositManual(msg, match) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const nominal = parseInt(match[1]);

        if (!nominal || nominal < 1000) {
            return this.bot.sendMessage(chatId, 
                "❌ *Minimal deposit Rp 1,000*\n\nContoh: `/deposit_manual 10000`", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const pendingDeposits = await this.db.loadPendingManualDeposits();
            
            const existingRequest = pendingDeposits.find(d => d.userId === userId && d.status === 'pending');
            if (existingRequest) {
                return this.bot.sendMessage(chatId,
                    `⚠️ *Request Sudah Ada*\n\n` +
                    `Anda masih memiliki request deposit manual:\n` +
                    `💰 Nominal: Rp ${existingRequest.nominal.toLocaleString('id-ID')}\n` +
                    `⏰ Dibuat: ${existingRequest.createdAt}\n\n` +
                    `Tunggu approval dari owner terlebih dahulu.`,
                    { parse_mode: 'Markdown' }
                );
            }

            const timeInfo = this.getIndonesianTime();
            const username = msg.from.username || 'Tidak ada';
            const fullName = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '');
            const requestId = `DEP-${Date.now()}`;

            const depositRequest = {
                requestId,
                userId,
                username,
                fullName,
                nominal,
                status: 'pending',
                createdAt: `${timeInfo.date} ${timeInfo.time}`,
                timestamp: Date.now()
            };

            pendingDeposits.push(depositRequest);
            await this.db.savePendingManualDeposits(pendingDeposits);

            await this.bot.sendMessage(chatId,
                `✅ *Request Deposit Manual Terkirim!*\n\n` +
                `🆔 Request ID: \`${requestId}\`\n` +
                `💰 Nominal: Rp ${nominal.toLocaleString('id-ID')}\n` +
                `📅 Tanggal: ${timeInfo.date}\n` +
                `🕐 Jam: ${timeInfo.time}\n\n` +
                `⏰ Menunggu approval dari owner...\n` +
                `📞 Hubungi @Jeeyhosting untuk konfirmasi pembayaran.`,
                { parse_mode: 'Markdown' }
            );

            try {
                await this.bot.sendMessage(this.config.OWNER_ID,
                    `🔔 *REQUEST DEPOSIT MANUAL BARU*\n\n` +
                    `🆔 Request ID: \`${requestId}\`\n` +
                    `👤 User ID: \`${userId}\`\n` +
                    `📛 Nama: ${fullName}\n` +
                    `📱 Username: @${username}\n` +
                    `💰 Nominal: Rp ${nominal.toLocaleString('id-ID')}\n` +
                    `📅 Waktu: ${timeInfo.date} ${timeInfo.time}\n\n` +
                    `Cek di Owner Panel untuk approve/reject.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (notifError) {
                console.log('Failed to notify owner:', notifError.message);
            }

        } catch (error) {
            console.error('Deposit manual error:', error);
            await this.bot.sendMessage(chatId,
                "❌ *System Error*\n\nGagal membuat request deposit manual.",
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleProdukAdd(msg) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        this.productAddStates.set(senderId, {
            step: 'name',
            data: {}
        });

        await this.bot.sendMessage(chatId,
            `➕ *TAMBAH PRODUK BARU*\n\n` +
            `📝 *Step 1/5:* Masukkan nama produk\n\n` +
            `Contoh: Netflix Premium 1 Bulan\n\n` +
            `Ketik /cancel untuk membatalkan.`,
            { parse_mode: 'Markdown' }
        );
    }

    async handleProductAddStep(msg, state) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (text === '/cancel') {
            this.productAddStates.delete(userId);
            return this.bot.sendMessage(chatId, '❌ Proses tambah produk dibatalkan.');
        }

        try {
            switch (state.step) {
                case 'name':
                    state.data.name = text;
                    state.step = 'description';
                    await this.bot.sendMessage(chatId,
                        `✅ Nama produk: ${text}\n\n` +
                        `📝 *Step 2/5:* Masukkan deskripsi produk\n\n` +
                        `Contoh: Akun Netflix Premium 1 bulan, bisa digunakan untuk 1 device`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'description':
                    state.data.description = text;
                    state.step = 'price';
                    await this.bot.sendMessage(chatId,
                        `✅ Deskripsi tersimpan\n\n` +
                        `📝 *Step 3/5:* Masukkan harga produk (angka saja)\n\n` +
                        `Contoh: 50000`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'price':
                    const price = parseInt(text);
                    if (isNaN(price) || price < 100) {
                        return this.bot.sendMessage(chatId, '❌ Harga tidak valid. Minimal Rp 100. Coba lagi:');
                    }
                    state.data.price = price;
                    state.step = 'stock';
                    await this.bot.sendMessage(chatId,
                        `✅ Harga: Rp ${price.toLocaleString('id-ID')}\n\n` +
                        `📝 *Step 4/5:* Masukkan jumlah stock (angka saja)\n\n` +
                        `Contoh: 10`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'stock':
                    const stock = parseInt(text);
                    if (isNaN(stock) || stock < 0) {
                        return this.bot.sendMessage(chatId, '❌ Stock tidak valid. Minimal 0. Coba lagi:');
                    }
                    state.data.stock = stock;
                    state.step = 'payment_method';
                    
                    const keyboard = {
                        inline_keyboard: [
                            [{ text: '⚡ QRIS Otomatis', callback_data: 'product_payment_auto' }],
                            [{ text: '📸 Manual (Upload Bukti)', callback_data: 'product_payment_manual' }],
                            [{ text: '🔄 Kedua-duanya', callback_data: 'product_payment_both' }]
                        ]
                    };

                    await this.bot.sendMessage(chatId,
                        `✅ Stock: ${stock}\n\n` +
                        `📝 *Step 5/5:* Pilih metode pembayaran\n\n` +
                        `⚡ *QRIS Otomatis* - User langsung bayar via QRIS, otomatis terverifikasi\n` +
                        `📸 *Manual* - User upload bukti transfer, owner approve\n` +
                        `🔄 *Kedua-duanya* - User bisa pilih salah satu metode`,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: keyboard
                        }
                    );
                    break;
                
                case 'product_image':
                    if (text.toLowerCase() === 'skip') {
                        state.step = 'product_data';
                        await this.bot.sendMessage(chatId,
                            `✅ Gambar dilewati\n\n` +
                            `📦 *STEP 7/7: Upload Data Produk*\n\n` +
                            `Silakan upload data produk yang akan dikirim ke pembeli:\n\n` +
                            `📝 *Format yang diterima:*\n` +
                            `1️⃣ **Text** - ketik langsung (email:password, link, dll)\n` +
                            `2️⃣ **File** - upload file (.txt, .pdf, .docx, dll)\n` +
                            `3️⃣ **Link** - kirim link Google Drive, Mega, dll\n\n` +
                            `💡 *Contoh:*\n` +
                            `\`email@gmail.com:password123\`\n` +
                            `atau upload file TXT/PDF\n\n` +
                            `Ketik atau upload sekarang:`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await this.bot.sendMessage(chatId,
                            `⚠️ Silakan upload gambar atau ketik *skip* untuk lewati.`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                    break;

                case 'product_data':
                    const products = await this.db.loadProducts();
                    const productId = `PROD-${Date.now()}`;
                    
                    const paymentMethodText = state.data.paymentMethod === 'auto' ? '⚡ QRIS Otomatis' : 
                                             state.data.paymentMethod === 'manual' ? '📸 Manual' : '🔄 Kedua-duanya';

                    const newProduct = {
                        id: productId,
                        name: state.data.name,
                        description: state.data.description,
                        price: state.data.price,
                        stock: state.data.stock,
                        paymentMethod: state.data.paymentMethod,
                        productData: {
                            type: 'text',
                            content: text
                        },
                        productImage: state.data.productImage || null,
                        createdAt: this.getIndonesianTimestamp(),
                        createdBy: userId
                    };

                    products.push(newProduct);
                    await this.db.saveProducts(products);

                    this.productAddStates.delete(userId);

                    await this.bot.sendMessage(chatId,
                        `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
                        `📦 Nama: ${newProduct.name}\n` +
                        `📝 Deskripsi: ${newProduct.description}\n` +
                        `💰 Harga: Rp ${newProduct.price.toLocaleString('id-ID')}\n` +
                        `📦 Stock: ${newProduct.stock}\n` +
                        `💳 Metode: ${paymentMethodText}\n` +
                        `📄 Data: Text\n` +
                        `🆔 ID: \`${productId}\`\n\n` +
                        `Produk sudah aktif dan bisa dibeli user!`,
                        { parse_mode: 'Markdown' }
                    );
                    break;
            }

            this.productAddStates.set(userId, state);

        } catch (error) {
            console.error('Product add step error:', error);
            this.productAddStates.delete(userId);
            await this.bot.sendMessage(chatId, '❌ Terjadi kesalahan. Silakan mulai lagi dengan /produk_add');
        }
    }

    async handleProdukList(msg) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const products = await this.db.loadProducts();

            if (products.length === 0) {
                return this.bot.sendMessage(chatId,
                    "📦 *DAFTAR PRODUK*\n\n" +
                    "Belum ada produk.\n\n" +
                    "Gunakan /produk_add untuk menambah produk.",
                    { parse_mode: 'Markdown' }
                );
            }

            let listText = `📦 *DAFTAR PRODUK*\n\n` +
                `Total: ${products.length} produk\n\n`;

            products.forEach((p, index) => {
                const paymentMethod = p.paymentMethod === 'auto' ? '⚡ QRIS Auto' : 
                                    p.paymentMethod === 'manual' ? '📸 Manual' : '🔄 Both';
                
                const dataType = p.productData ? 
                    (p.productData.type === 'file' ? `📄 File (${p.productData.fileName})` : '📝 Text') :
                    '❌ Tidak ada data';
                
                listText += `${index + 1}. *${p.name}*\n`;
                listText += `   💰 Harga: Rp ${p.price.toLocaleString('id-ID')}\n`;
                listText += `   📦 Stock: ${p.stock}\n`;
                listText += `   💳 Metode: ${paymentMethod}\n`;
                listText += `   📄 Data: ${dataType}\n`;
                listText += `   🆔 ID: \`${p.id}\`\n\n`;
            });

            listText += `\n💡 Gunakan Owner Panel untuk manage produk.`;

            await this.bot.sendMessage(chatId, listText, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Produk list error:', error);
            await this.bot.sendMessage(chatId, '❌ Error loading products.');
        }
    }

    async handleDelProduk(msg, match) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;
        const productId = match[1].trim();

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const products = await this.db.loadProducts();
            const productIndex = products.findIndex(p => p.id === productId);

            if (productIndex === -1) {
                return this.bot.sendMessage(chatId,
                    `❌ *PRODUK TIDAK DITEMUKAN*\n\n` +
                    `Product ID \`${productId}\` tidak ditemukan.\n\n` +
                    `Gunakan /produk_list untuk melihat daftar produk.`,
                    { parse_mode: 'Markdown' }
                );
            }

            const product = products[productIndex];
            products.splice(productIndex, 1);
            await this.db.saveProducts(products);

            await this.bot.sendMessage(chatId,
                `✅ *PRODUK BERHASIL DIHAPUS*\n\n` +
                `📦 Nama: ${product.name}\n` +
                `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                `📦 Stock: ${product.stock}\n` +
                `🆔 ID: \`${productId}\`\n\n` +
                `Produk telah dihapus dari database.`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('Delete product error:', error);
            await this.bot.sendMessage(chatId,
                `❌ *Terjadi Kesalahan*\n\n` +
                `Gagal menghapus produk. Silakan coba lagi atau hubungi developer.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleHistoryProduk(msg) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        try {
            const productOrders = await this.db.loadProductOrders();
            const userOrders = productOrders.filter(order => order.userId === userId.toString());

            if (userOrders.length === 0) {
                return this.bot.sendMessage(chatId,
                    `📜 *RIWAYAT PRODUK DIGITAL*\n\n` +
                    `Belum ada riwayat pembelian produk.\n\n` +
                    `Silakan beli produk di menu 🛍️ Produk Digital.`,
                    { parse_mode: 'Markdown' }
                );
            }

            let historyText = `📜 *RIWAYAT PRODUK DIGITAL*\n\n`;
            historyText += `Total: ${userOrders.length} pembelian\n\n`;

            const completedOrders = userOrders.filter(o => o.status === 'completed' || o.status === 'approved');
            const pendingOrders = userOrders.filter(o => o.status === 'pending');
            const rejectedOrders = userOrders.filter(o => o.status === 'rejected');

            historyText += `✅ Selesai: ${completedOrders.length}\n`;
            historyText += `⏳ Pending: ${pendingOrders.length}\n`;
            historyText += `❌ Ditolak: ${rejectedOrders.length}\n\n`;
            historyText += `━━━━━━━━━━━━━━━━\n\n`;

            userOrders.slice(0, 10).forEach((order, index) => {
                const statusIcon = (order.status === 'completed' || order.status === 'approved') ? '✅' : 
                                  order.status === 'pending' ? '⏳' : '❌';
                const statusText = (order.status === 'completed' || order.status === 'approved') ? 'Selesai' : 
                                  order.status === 'pending' ? 'Pending' : 'Ditolak';

                historyText += `${index + 1}. ${statusIcon} *${order.productName}*\n`;
                historyText += `   💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n`;
                historyText += `   📝 Status: ${statusText}\n`;
                historyText += `   📅 Tanggal: ${order.timeInfo ? order.timeInfo.date : 'N/A'}\n`;
                historyText += `   🕐 Jam: ${order.timeInfo ? order.timeInfo.time : 'N/A'}\n`;
                historyText += `   🆔 Order ID: \`${order.orderId}\`\n\n`;
            });

            if (userOrders.length > 10) {
                historyText += `\n... dan ${userOrders.length - 10} pembelian lainnya`;
            }

            await this.bot.sendMessage(chatId, historyText, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('History produk error:', error);
            await this.bot.sendMessage(chatId,
                `❌ *Terjadi Kesalahan*\n\n` +
                `Gagal memuat riwayat produk. Silakan coba lagi.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleDelete(msg, match) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;
        const targetUserId = match[1];

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const users = await this.db.loadUsers();
            const userIndex = users.findIndex(u => u.id === targetUserId.toString());

            if (userIndex === -1) {
                return this.bot.sendMessage(chatId,
                    `❌ *User Tidak Ditemukan*\n\nUser ID: \`${targetUserId}\` tidak ada di database.`,
                    { parse_mode: 'Markdown' }
                );
            }

            const deletedUser = users[userIndex];
            
            const orders = await this.db.loadOrders();
            const hasActiveOrder = orders[targetUserId];
            
            if (hasActiveOrder) {
                if (this.activeMonitors.has(targetUserId)) {
                    clearInterval(this.activeMonitors.get(targetUserId));
                    this.activeMonitors.delete(targetUserId);
                }
                
                const serverKey = hasActiveOrder.providerKey;
                if (serverKey) {
                    try {
                        const provider = this.providerManager.getProvider(serverKey);
                        await provider.cancelOrder(hasActiveOrder.orderId);
                    } catch (e) {
                        console.log('Failed to cancel order on provider:', e.message);
                    }
                }
                
                delete orders[targetUserId];
                await this.db.saveOrders(orders);
            }

            users.splice(userIndex, 1);
            await this.db.saveUsers(users);

            const timeInfo = this.getIndonesianTime();

            await this.bot.sendMessage(chatId,
                `✅ *User Berhasil Dihapus*\n\n` +
                `🆔 ID: \`${targetUserId}\`\n` +
                `💰 Saldo Terhapus: Rp ${deletedUser.saldo.toLocaleString('id-ID')}\n` +
                `📅 Tanggal Join: ${deletedUser.date || 'N/A'}\n` +
                `📦 Order Aktif: ${hasActiveOrder ? 'Dibatalkan' : 'Tidak ada'}\n` +
                `🕐 Dihapus: ${timeInfo.date} ${timeInfo.time}\n\n` +
                `Data user telah dihapus dari data.json`,
                { parse_mode: 'Markdown' }
            );

            try {
                await this.bot.sendMessage(targetUserId,
                    `⚠️ *Akun Anda Telah Dihapus*\n\n` +
                    `Admin telah menghapus akun Anda dari sistem.\n` +
                    `Ketik /start untuk daftar ulang.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (notifError) {
                console.log(`Cannot notify deleted user ${targetUserId}`);
            }

        } catch (error) {
            console.error('Delete user error:', error);
            await this.bot.sendMessage(chatId,
                `❌ *System Error*\n\nGagal menghapus user.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleInfo(msg, match) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;
        const targetUserId = match[1];

        if (senderId !== this.config.OWNER_ID) {
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const users = await this.db.loadUsers();
            const user = users.find(u => u.id === targetUserId.toString());

            if (!user) {
                return this.bot.sendMessage(chatId,
                    `❌ *User Tidak Ditemukan*\n\nUser ID: \`${targetUserId}\` tidak ada di database.`,
                    { parse_mode: 'Markdown' }
                );
            }

            const orders = await this.db.loadOrders();
            const hasActiveOrder = orders[targetUserId] ? 'Ya' : 'Tidak';
            const activeOrderInfo = orders[targetUserId] ? 
                `\n📋 Order Aktif:\n` +
                `   Nomor: +${orders[targetUserId].number}\n` +
                `   Layanan: ${orders[targetUserId].serviceName}\n` +
                `   Harga: Rp ${orders[targetUserId].price.toLocaleString('id-ID')}\n` +
                `   Order ID: ${orders[targetUserId].orderId}` : '';

            const history = await this.db.loadHistory();
            const userHistory = history[targetUserId] || [];
            const totalOrders = userHistory.length;
            const totalSpent = userHistory.reduce((sum, order) => sum + (order.price || 0), 0);

            let userInfo = `👤 *INFO USER*\n\n` +
                `🆔 ID: \`${targetUserId}\`\n` +
                `💰 Saldo: Rp ${user.saldo.toLocaleString('id-ID')}\n` +
                `📅 Tanggal Join: ${user.date || 'N/A'}\n` +
                `📦 Pesanan Aktif: ${hasActiveOrder}${activeOrderInfo}\n\n` +
                `📊 *Statistik:*\n` +
                `📋 Total Order Selesai: ${totalOrders}\n` +
                `💵 Total Pengeluaran: Rp ${totalSpent.toLocaleString('id-ID')}\n`;

            if (totalOrders > 0) {
                const lastOrder = userHistory[0];
                userInfo += `\n🕐 *Order Terakhir:*\n` +
                    `   Layanan: ${lastOrder.serviceName}\n` +
                    `   Negara: ${lastOrder.country}\n` +
                    `   Harga: Rp ${lastOrder.price.toLocaleString('id-ID')}\n` +
                    `   Waktu: ${lastOrder.completedAt}`;
            }

            try {
                const chatInfo = await this.bot.getChat(targetUserId);
                const username = chatInfo.username ? `@${chatInfo.username}` : 'Tidak ada';
                const fullName = chatInfo.first_name + (chatInfo.last_name ? ` ${chatInfo.last_name}` : '');
                
                userInfo = `👤 *INFO USER*\n\n` +
                    `🆔 ID: \`${targetUserId}\`\n` +
                    `👤 Nama: ${fullName}\n` +
                    `📱 Username: ${username}\n` +
                    `💰 Saldo: Rp ${user.saldo.toLocaleString('id-ID')}\n` +
                    `📅 Tanggal Join: ${user.date || 'N/A'}\n` +
                    `📦 Pesanan Aktif: ${hasActiveOrder}${activeOrderInfo}\n\n` +
                    `📊 *Statistik:*\n` +
                    `📋 Total Order Selesai: ${totalOrders}\n` +
                    `💵 Total Pengeluaran: Rp ${totalSpent.toLocaleString('id-ID')}\n`;

                if (totalOrders > 0) {
                    const lastOrder = userHistory[0];
                    userInfo += `\n🕐 *Order Terakhir:*\n` +
                        `   Layanan: ${lastOrder.serviceName}\n` +
                        `   Negara: ${lastOrder.country}\n` +
                        `   Harga: Rp ${lastOrder.price.toLocaleString('id-ID')}\n` +
                        `   Waktu: ${lastOrder.completedAt}`;
                }
            } catch (chatError) {
                console.log(`Cannot get chat info for ${targetUserId}`);
            }

            await this.bot.sendMessage(chatId, userInfo, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Info user error:', error);
            await this.bot.sendMessage(chatId,
                `❌ *System Error*\n\nGagal mengambil info user.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleDeposit(msg, match) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const nominalAsli = parseInt(match[1]);

        if (!nominalAsli || nominalAsli < 1000) {
            return this.bot.sendMessage(chatId, "❌ Minimal deposit Rp 1,000\nContoh: `/deposit 5000`", {
                parse_mode: 'Markdown'
            });
        }

        const activeDeposit = this.autoPending.find(trx => 
            trx.id === chatId && !trx.done && !trx.cancelled
        );

        if (activeDeposit) {
            const elapsedTime = Date.now() - activeDeposit.startTime;
            const elapsedMinutes = Math.floor(elapsedTime / 60000);
            const elapsedSeconds = Math.floor((elapsedTime % 60000) / 1000);
            
            const timeText = elapsedMinutes > 0 
                ? `${elapsedMinutes} menit ${elapsedSeconds} detik`
                : `${elapsedSeconds} detik`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "❌ Cancel Deposit Aktif", callback_data: `cancel_deposit_${activeDeposit.trx_id}` }]
                ]
            };

            return this.bot.sendMessage(chatId, 
                `⚠️ *DEPOSIT MASIH AKTIF*\n\n` +
                `🆔 ID: \`${activeDeposit.trx_id}\`\n` +
                `💰 Nominal: Rp ${activeDeposit.get_balance.toLocaleString('id-ID')}\n` +
                `⏰ Dibuat: ${timeText} yang lalu\n\n` +
                `❌ Anda harus **cancel** terlebih dahulu sebelum membuat deposit baru.\n\n` +
                `💡 Klik tombol di bawah untuk cancel:`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }
            );
        }

        const reff_id = `reff-${chatId}-${Date.now()}`;

        try {
            const params = new URLSearchParams({
                nominal: nominalAsli.toString(),
                metode: 'QRISFAST'
            });

            const res = await axios.get(`${this.config.CIAATOPUP_CREATE_URL}?${params}`, {
                headers: { 
                    'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            if (!res.data || res.data.success !== true || !res.data.data || !res.data.data.qr_string) {
                return this.bot.sendMessage(chatId, "❌ Gagal membuat deposit.\n\n📎 Respon: " + JSON.stringify(res.data));
            }

            const data = res.data.data;
            
            const qrBuffer = await QRCode.toBuffer(data.qr_string);

            const teks = `💳 *PEMBAYARAN VIA QRIS*\n` +
                `🆔 *ID Transaksi:* \`${data.id}\`\n` +
                `💰 Nominal: Rp ${nominalAsli.toLocaleString("id-ID")}\n` +
                `🧾 Biaya Admin: Rp ${data.fee.toLocaleString("id-ID")}\n` +
                `💸 Total Bayar: Rp ${data.nominal.toLocaleString("id-ID")}\n` +
                `💎 Saldo Diterima: Rp ${data.get_balance.toLocaleString("id-ID")}\n` +
                `📅 Expired: ${data.expired_at}\n\n` +
                `📲 *Scan QR di bawah pakai:*\n` +
                `DANA / OVO / ShopeePay / GoPay/DLL\n\n` +
                `Saldo akan otomatis masuk setelah pembayaran berhasil.\n\n` +
                `⏰ *PENTING:* Deposit ini akan auto-cancel dalam 10 menit jika tidak dibayar.\n` +
                `⚠️ Segera bayar agar tidak di-cancel otomatis!\n\n` +
                `💬 *Jika sudah transfer dan saldo tidak masuk dalam 5 menit, segera hubungi owner @Jeeyhosting*`;

            const inlineKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "❌ BATAL", callback_data: `cancel_deposit_${data.id}` }]
                    ]
                }
            };

            const sent = await this.bot.sendPhoto(chatId, qrBuffer, {
                caption: teks,
                parse_mode: "Markdown",
                ...inlineKeyboard
            });

            this.autoPending.push({
                id: chatId,
                trx_id: data.id,
                get_balance: data.get_balance,
                user_name: msg.from.first_name + (msg.from.last_name ? " " + msg.from.last_name : ""),
                done: false,
                msgId: sent.message_id,
                startTime: Date.now()
            });
        } catch (err) {
            console.log("❌ ERROR DEPOSIT:", err.message);
            this.bot.sendMessage(chatId, "❌ Terjadi kesalahan saat membuat deposit.");
        }
    }

    async cancelDeposit(query) {
        const msg = query.message;
        const data = query.data;
        const chatId = msg.chat.id;
        const trxId = data.replace('cancel_deposit_', '');

        console.log(`Cancel deposit request for transaction: ${trxId}`);

        try {
            const pendingIndex = this.autoPending.findIndex(trx => trx.trx_id === trxId && !trx.done);
            
            if (pendingIndex === -1) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: "❌ Transaksi tidak ditemukan atau sudah selesai",
                    show_alert: true
                });
                return;
            }

            this.autoPending[pendingIndex].done = true;
            this.autoPending[pendingIndex].cancelled = true;

            try {
                await this.bot.deleteMessage(chatId, msg.message_id);
                console.log(`✅ QRIS message deleted for ${trxId}`);
            } catch (deleteError) {
                console.log(`⚠️ Cannot delete QRIS message: ${deleteError.message}`);
            }

            let ciaatopupStatus = 'local_cancelled';
            
            try {
                const params = new URLSearchParams({
                    id: trxId
                });

                const cancelRes = await axios.get(`${this.config.CIAATOPUP_CANCEL_URL}?${params}`, {
                    headers: { 
                        'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 3000
                });

                if (cancelRes.data && cancelRes.data.success === true) {
                    ciaatopupStatus = 'ciaatopup_cancelled';
                }
            } catch (ciaatopupError) {
                console.log(`CiaaTopUp cancel timeout/error: ${ciaatopupError.message}`);
            }

            const timeInfo = this.getIndonesianTime();
            const nominal = this.autoPending[pendingIndex].get_balance;
            
            const successText = `✅ *DEPOSIT DIBATALKAN*\n\n` +
                `🆔 ID: \`${trxId}\`\n` +
                `💰 Nominal: Rp ${nominal.toLocaleString('id-ID')}\n` +
                `📊 Status: Berhasil dibatalkan\n` +
                `📅 Tanggal: ${timeInfo.date}\n` +
                `🕐 Jam: ${timeInfo.time}\n\n` +
                `💡 Silakan buat deposit baru jika diperlukan.\n` +
                `Ketik /start Untuk Ke Menu Utama`;

            const keyboard = {
                inline_keyboard: []
            };

            await this.bot.sendMessage(chatId, successText, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });

            await this.bot.answerCallbackQuery(query.id, {
                text: "✅ Transaksi berhasil dibatalkan"
            });

            console.log(`✅ Cancel deposit completed for ${trxId}`);

        } catch (err) {
            console.error(`❌ CRITICAL ERROR cancelDeposit ${trxId}:`, err.message);
            
            try {
                const emergencyIndex = this.autoPending.findIndex(trx => trx.trx_id === trxId);
                if (emergencyIndex !== -1) {
                    this.autoPending[emergencyIndex].done = true;
                    this.autoPending[emergencyIndex].cancelled = true;
                }

                await this.bot.sendMessage(chatId, 
                    `❌ DEPOSIT DIBATALKAN (ERROR SISTEM)\n\n` +
                    `ID: ${trxId}\n` +
                    `Status: Dibatalkan meskipun ada error\n` +
                    `Waktu: ${new Date().toLocaleString('id-ID')}\n\n` +
                    `Hubungi admin jika ada masalah: @Jeeyhosting`
                );

                await this.bot.answerCallbackQuery(query.id, {
                    text: "⚠️ Dibatalkan tapi ada error sistem"
                });

            } catch (emergencyError) {
                console.error(`❌ EMERGENCY FALLBACK FAILED:`, emergencyError.message);
                
                try {
                    await this.bot.answerCallbackQuery(query.id, {
                        text: "❌ Error sistem, hubungi admin"
                    });
                } catch (finalError) {
                    console.error(`❌ FINAL FALLBACK FAILED:`, finalError.message);
                }
            }
        }
    }

    startDepositMonitoring() {
        setInterval(async () => {
            try {
                for (let i = 0; i < this.autoPending.length; i++) {
                    const trx = this.autoPending[i];
                    if (trx.done || trx.cancelled) continue;

                    if (!trx.startTime) {
                        trx.startTime = Date.now();
                    }

                    const elapsedTime = Date.now() - trx.startTime;
                    const maxMonitoringTime = 10 * 60 * 1000;

                    if (elapsedTime > maxMonitoringTime && !trx.done) {
                        console.log(`⏰ Auto-cancelling deposit ${trx.trx_id} after 10 minutes`);
                        trx.done = true;
                        
                        try {
                            const params = new URLSearchParams({
                                id: trx.trx_id
                            });
                            
                            await axios.get(`${this.config.CIAATOPUP_CANCEL_URL}?${params}`, {
                                headers: { 
                                    'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                                    'Content-Type': 'application/json'
                                },
                                timeout: 3000
                            });
                        } catch (cancelErr) {
                            console.log(`⚠️ Failed to cancel at CiaaTopUp: ${cancelErr.message}`);
                        }
                        
                        await this.cleanupDeposit(trx.id, trx.msgId, trx.trx_id, trx.get_balance, 'expired');
                        continue;
                    }

                    const params = new URLSearchParams({
                        id: trx.trx_id
                    });

                    try {
                        const res = await axios.get(`${this.config.CIAATOPUP_STATUS_URL}?${params}`, {
                            headers: { 
                                'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            timeout: 5000
                        });
                        
                        const status = res.data?.data?.status;

                        if (status === "success") {
                            if (trx.isProduct) {
                                const products = await this.db.loadProducts();
                                const productIndex = products.findIndex(p => p.id === trx.productId);

                                if (productIndex !== -1) {
                                    products[productIndex].stock -= 1;
                                    await this.db.saveProducts(products);

                                    const product = products[productIndex];
                                    const timeInfo = this.getIndonesianTime();
                                    const orderId = `PROD-${Date.now()}`;

                                    const productData = product.productData;
                                    if (productData) {
                                        if (productData.type === 'file') {
                                            await this.bot.sendDocument(trx.id, productData.fileId, {
                                                caption: 
                                                    `✅ *PEMBELIAN BERHASIL!*\n\n` +
                                                    `🆔 Order ID: \`${orderId}\`\n` +
                                                    `📦 Produk: ${product.name}\n` +
                                                    `💰 Harga: Rp ${trx.get_balance.toLocaleString('id-ID')}\n` +
                                                    `📅 Tanggal: ${timeInfo.date}\n` +
                                                    `🕐 Jam: ${timeInfo.time}\n\n` +
                                                    `📄 Data produk di atas.\n\n` +
                                                    `Terima kasih!`,
                                                parse_mode: 'Markdown'
                                            });
                                        } else if (productData.type === 'text') {
                                            await this.bot.sendMessage(trx.id,
                                                `✅ *PEMBELIAN BERHASIL!*\n\n` +
                                                `🆔 Order ID: \`${orderId}\`\n` +
                                                `📦 Produk: ${product.name}\n` +
                                                `💰 Harga: Rp ${trx.get_balance.toLocaleString('id-ID')}\n` +
                                                `📅 Tanggal: ${timeInfo.date}\n` +
                                                `🕐 Jam: ${timeInfo.time}\n\n` +
                                                `📄 *Data Produk:*\n` +
                                                `\`\`\`\n${productData.content}\n\`\`\`\n\n` +
                                                `Terima kasih!`,
                                                { parse_mode: 'Markdown' }
                                            );
                                        }
                                    }

                                    try {
                                        const username = await this.getUsernameDisplay(trx.id);
                                        
                                        await this.sendTestimonialNotification(
                                            product.name,
                                            trx.get_balance,
                                            username,
                                            orderId
                                        );
                                        
                                        await this.bot.sendMessage(this.config.OWNER_ID,
                                            `🛍️ *PEMBELIAN PRODUK BARU*\n\n` +
                                            `🆔 Order ID: \`${orderId}\`\n` +
                                            `👤 User ID: \`${trx.id}\`\n` +
                                            `📱 Username: @${username}\n` +
                                            `📦 Produk: ${product.name}\n` +
                                            `💰 Harga: Rp ${trx.get_balance.toLocaleString('id-ID')}\n` +
                                            `💳 Metode: QRIS Otomatis\n` +
                                            `📅 Waktu: ${timeInfo.date} ${timeInfo.time}\n\n` +
                                            `✅ Data produk sudah dikirim otomatis ke customer!`,
                                            { parse_mode: 'Markdown' }
                                        );
                                    } catch (notifError) {
                                        console.log('Failed to notify owner:', notifError.message);
                                    }
                                }
                            } else {
                                const users = await this.db.loadUsers();
                                const userIndex = users.findIndex(user => user.id === trx.id.toString());

                                if (userIndex !== -1) {
                                    users[userIndex].saldo += trx.get_balance;
                                    users[userIndex].date = this.getIndonesianTimestamp();
                                } else {
                                    users.push({
                                        id: trx.id.toString(),
                                        saldo: trx.get_balance,
                                        date: this.getIndonesianTimestamp()
                                    });
                                }

                                await this.db.saveUsers(users);
                            }

                            trx.done = true;
                            trx.completedAt = Date.now();
                            await this.cleanupDeposit(trx.id, trx.msgId, trx.trx_id, trx.get_balance, 'success');

                        } else if (["expired", "failed", "cancel"].includes(status)) {
                            trx.done = true;
                            trx.completedAt = Date.now();
                            await this.cleanupDeposit(trx.id, trx.msgId, trx.trx_id, trx.get_balance, 'expired');
                        }

                    } catch (err) {
                        console.log(`[AUTO-CEK] Gagal cek ${trx.trx_id}:`, err.message);
                    }
                }
            } catch (error) {
                console.error('Deposit monitoring error:', error);
            }
        }, 10 * 1000);
    }

    async cleanupDeposit(chatId, msgId, trxId, nominal, status) {
        try { await this.bot.deleteMessage(chatId, msgId); } catch {}
        const time = this.getIndonesianTime();
        const text = status === 'success'
            ? `✅ Deposit sukses Rp ${nominal.toLocaleString('id-ID')}`
            : `⏰ Deposit expired Rp ${nominal.toLocaleString('id-ID')}`;
        await this.bot.sendMessage(chatId, `${text}\n🆔 ${trxId} | 🕐 ${time.full}`, { parse_mode: 'Markdown' });
    }

    startCleanupWorker() {
        setInterval(() => {
            const now = Date.now();
            
            for (const [lockId, timestamp] of this.userLocks.entries()) {
                if (now - timestamp > 30000) {
                    console.log(`Clearing stuck lock: ${lockId}`);
                    this.userLocks.delete(lockId);
                }
            }
            
            this.pendingOrders.clear();
            
            const oldRefundLocks = [];
            for (const refundKey of this.refundLocks) {
                oldRefundLocks.push(refundKey);
            }
            
            if (oldRefundLocks.length > 100) {
                oldRefundLocks.slice(0, 50).forEach(key => this.refundLocks.delete(key));
            }
            
            this.autoPending = this.autoPending.filter(trx => {
                if (trx.done || trx.cancelled) {
                    const timeSinceDone = now - (trx.completedAt || trx.startTime || 0);
                    if (timeSinceDone > 5 * 60 * 1000) {
                        console.log(`🗑️ Removing completed transaction ${trx.trx_id} from memory`);
                        return false;
                    }
                }
                return true;
            });
            
        }, 60000);
    }

    async checkBalance(chatId, messageId, userId) {
        const user = await this.getUser(userId);
        const saldo = user ? user.saldo : 0;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '💳 Top Up', callback_data: 'topup' }],
                [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
            ]
        };

        const text = saldo === 0 ? 
            '💰 Saldo Anda\n\nRp 0\n\nSilakan top up untuk mulai order.' :
            `💰 Saldo Anda\n\nRp ${saldo.toLocaleString('id-ID')}`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, text, keyboard);
    }
    
    async showOrderHistory(chatId, messageId, userId) {
        const history = await this.db.loadHistory();
        const userHistory = history[userId] || [];
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'order_history' }],
                [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
            ]
        };

        if (userHistory.length === 0) {
            const emptyText = '📜 RIWAYAT ORDER\n\n📄 Belum ada riwayat order.\nRiwayat akan muncul setelah Anda berhasil mendapatkan SMS.';
            
            try {
                await this.bot.editMessageCaption(emptyText, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            } catch (e) {
                if (e.response?.body?.description?.includes("message is not modified")) {
                    return;
                }
                await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, emptyText, keyboard);
            }
            return;
        }

        let historyText = '📜 RIWAYAT ORDER\n\n';
        historyText += '📊 Total: ' + userHistory.length + ' order berhasil\n\n';

        const displayHistory = userHistory.slice(0, 5);
        
        displayHistory.forEach((order, index) => {
            const hiddenNumber = order.number ? 
                order.number.substring(0, 4) + 'xxx' + order.number.substring(order.number.length - 3) :
                'N/A';
            
            const fullOTP = order.smsCode || 'N/A';
            
            historyText += (index + 1) + '. 📱 ' + (order.serviceName || 'Unknown Service') + '\n';
            historyText += '   🌍 ' + (order.country || 'Unknown') + '\n';
            historyText += '   📞 +' + hiddenNumber + '\n';
            historyText += '   🔑 OTP: ' + fullOTP + '\n';
            historyText += '   💰 Rp ' + (order.price ? order.price.toLocaleString('id-ID') : '0') + '\n';
            historyText += '   📅 ' + (order.completedAt || 'Unknown time') + '\n\n';
        });

        if (userHistory.length > 5) {
            historyText += '... dan ' + (userHistory.length - 5) + ' order lainnya\n\n';
        }

        historyText += '💡 Info: Hanya 5 order terakhir yang ditampilkan.\n';
        historyText += 'Order yang berhasil mendapat SMS tersimpan di riwayat.';

        if (historyText.length > 1000) {
            historyText = historyText.substring(0, 950) + '\n\n... (terpotong)';
        }

        try {
            await this.bot.editMessageCaption(historyText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            if (e.response?.body?.description?.includes("message is not modified")) {
                return;
            }
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, historyText, keyboard);
        }
    }

    async showActiveOrders(chatId, messageId, userId) {
        const orders = await this.db.loadOrders();
        
        if (!orders[userId]) {
            const keyboard = {
                inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
            };

            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                '📋 *Tidak ada pesanan aktif*',
                keyboard
            );
            return;
        }

        const order = orders[userId];
        const elapsedTime = Date.now() - order.timestamp;
        const elapsedMinutes = Math.floor(elapsedTime / 60000);
        const elapsedSeconds = Math.floor((elapsedTime % 60000) / 1000);

        const serverKey = order.providerKey;
        const providerConfig = serverKey ? this.config.PROVIDERS[serverKey] : null;

        let statusText = '';
        let buttonText = '';
        let callbackData = '';
        
        if (order.status === 'cancelling') {
            statusText = '🔄 Sedang dibatalkan...';
            buttonText = '⏳ Memproses...';
            callbackData = 'cancel_processing';
        } else if (elapsedMinutes < 5) {
            const remainingMinutes = 5 - elapsedMinutes;
            const remainingSeconds = 60 - elapsedSeconds;
            if (remainingMinutes > 0) {
                statusText = `⏳ Button cancel muncul dalam ${remainingMinutes} menit`;
            } else {
                statusText = `⏳ Button cancel muncul dalam ${remainingSeconds} detik`;
            }
            buttonText = '⏰ Tunggu 5 Menit';
            callbackData = 'cancel_wait_5_minutes';
        } else if (elapsedMinutes >= 8) {
            statusText = '🔴 Auto refund akan dimulai';
            buttonText = '❌ Batalkan Sekarang';
            callbackData = `cancel_${order.orderId}`;
        } else {
            statusText = '✅ Bisa dibatalkan manual';
            buttonText = '❌ Batalkan Order';
            callbackData = `cancel_${order.orderId}`;
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: buttonText, callback_data: callbackData }],
                [{ text: '🔄 Refresh', callback_data: 'active_orders' }],
                [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
            ]
        };

        let timeText = '';
        if (elapsedMinutes > 0) {
            timeText = `${elapsedMinutes} menit ${elapsedSeconds} detik yang lalu`;
        } else {
            timeText = `${elapsedSeconds} detik yang lalu`;
        }

        const activeText = `📋 *Pesanan Aktif*\n\n` +
            `📡 Server: ${providerConfig ? providerConfig.emoji + ' ' + providerConfig.name : 'Unknown'}\n` +
            `📱 Nomor: +${order.number}\n` +
            `📧 Layanan: ${order.serviceName}\n` +
            `🌍 Negara: ${order.country}\n` +
            `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n` +
            `🆔 ID: ${order.orderId}\n` +
            `⏰ Waktu: ${timeText}\n\n` +
            `📊 Status: ${statusText}\n\n` +
            `⏳ Menunggu SMS masuk...\n` +
            `🤖 Auto refund jika tidak ada SMS dalam 5 menit`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, activeText, keyboard);
    }

    async showTopup(chatId, messageId) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
            ]
        };

        const topupText = `💳 *Top Up Saldo*\n\n` +
            `🤖 *Deposit Otomatis via QRIS:*\n` +
            `Gunakan command: \`/deposit JUMLAH\`\n\n` +
            `📝 *Contoh:*\n` +
            `• \`/deposit 10000\` = Top up Rp 10,000\n` +
            `• \`/deposit 50000\` = Top up Rp 50,000\n\n` +
            `💰 *Minimum deposit:* Rp 1,000\n` +
            `🦊 *Biaya admin:* Otomatis (dari CiaaTopUp)\n` +
            `⚡ *Proses:* Otomatis & Instan\n` +
            `💳 *Metode:* DANA, OVO, GoPay, ShopeePay\n\n` +
            `📸 *Deposit Manual:*\n` +
            `Gunakan command: \`/deposit_manual JUMLAH\`\n\n` +
            `📝 *Contoh:*\n` +
            `• \`/deposit_manual 10000\`\n\n` +
            `⏰ Request akan dikirim ke owner untuk approval.\n` +
            `Hubungi @Jeeyhosting untuk konfirmasi pembayaran.\n\n` +
            `📞 *Manual Transfer:*\n` +
            `Hubungi admin jika butuh bantuan:\n` +
            `📱 Telegram: @Jeeyhosting`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, topupText, keyboard);
    }

    async showRules(chatId, messageId) {
        const keyboard = {
            inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
        };

        const rulesText = `📜 *SYARAT & KETENTUAN*

⚠️ *WAJIB DIBACA:*

📸 1 nomor = 1 SMS/OTP  
📸 Saldo tidak bisa ditarik/refund manual  
📸 Tidak ada refund jika salah pilih layanan  
📸 Bot tidak bertanggung jawab jika OTP sudah masuk  

📸 *Kebijakan:*
- Order = setuju semua aturan
- SMS tidak masuk 8 menit = auto refund
- Saldo hanya untuk beli nomor SMS
- Force majeur: gangguan provider, saldo tetap aman

📸 *Tanggung Jawab:*
- Nomor sudah terdaftar bukan tanggung jawab bot
- Kesalahan input / aplikasi tidak kirim OTP = user risk
- Gangguan jaringan provider = tunggu restock otomatis

👨‍💻 Butuh bantuan / report bug? → @Jeeyhosting`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, rulesText, keyboard);
    }

    async showHelp(chatId, messageId) {
        const keyboard = {
            inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
        };

        const helpText = `📚 *PANDUAN LENGKAP - MARKETPLACE PRODUK DIGITAL*

━━━━━━━━━━━━━━━━━━━━

🛍️ *CARA MEMBELI PRODUK:*

1️⃣ Klik menu 🛍️ Produk Digital
2️⃣ Pilih produk yang diinginkan
3️⃣ Pilih metode pembayaran:
   • 💰 Saldo (jika cukup)
   • ⚡ QRIS Auto (instant)
   • 📸 Manual (upload bukti)
4️⃣ Selesaikan pembayaran
5️⃣ Produk otomatis terkirim!

━━━━━━━━━━━━━━━━━━━━

💳 *CARA ISI SALDO:*

1. Klik 💳 Top Up di Menu
2. Pilih nominal (min Rp 1.000)
3. Scan QRIS yang muncul
4. Bayar via e-wallet/banking
5. Saldo masuk dalam 1-30 detik!

⚠️ Saldo TIDAK BISA di-refund!

━━━━━━━━━━━━━━━━━━━━

📱 *METODE PEMBAYARAN:*

*⚡ QRIS Otomatis*
✅ Proses instant (1-30 detik)
✅ Verifikasi otomatis
✅ Produk langsung terkirim

*📸 Upload Bukti Manual*
⏱️ Verifikasi 5-30 menit
📷 Upload screenshot transfer
✅ Produk dikirim setelah approve

*💰 Bayar Pakai Saldo*
✅ Instant tanpa biaya tambahan
✅ Produk langsung terkirim

━━━━━━━━━━━━━━━━━━━━

❓ *FAQ:*

Q: Produk tidak terkirim?
A: Hubungi @Jeeyhosting dengan Order ID

Q: Saldo bisa di-refund?
A: TIDAK. Gunakan untuk beli produk.

Q: Berapa lama verifikasi manual?
A: 5-30 menit (tergantung owner)

Q: Bisa batal setelah bayar?
A: Tidak bisa. Cek produk sebelum beli.

Q: File size limit?
A: Unlimited! Support hingga 2TB/produk

━━━━━━━━━━━━━━━━━━━━

💡 *TIPS:*

1. Pastikan saldo cukup
2. Cek deskripsi produk teliti
3. Simpan Order ID
4. Gunakan QRIS untuk instant
5. Hubungi admin jika ada masalah

━━━━━━━━━━━━━━━━━━━━

🔒 *KEAMANAN:*

✅ Database anti-tamper encrypted
✅ Payment gateway terpercaya
✅ Data pribadi dilindungi
✅ Auto-refund jika gagal
✅ Support 24/7

━━━━━━━━━━━━━━━━━━━━

🌟 *KEUNGGULAN:*

✨ Unlimited storage (5TB+)
✨ Auto-delivery instant
✨ Multiple payment methods
✨ Database secure
✨ Real-time notification

━━━━━━━━━━━━━━━━━━━━

👨‍💻 *Bot Creator:* @Jeeyhosting
💬 *Support 24/7:* @Jeeyhosting`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, helpText, keyboard);
    }

    async showTopUsers(chatId, messageId) {
        try {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '💰 Top Saldo', callback_data: 'top_saldo' }],
                    [{ text: '📦 Top Orders', callback_data: 'top_orders' }],
                    [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
                ]
            };

            const topText = `🏆 *TOP USERS*\n\n` +
                `Pilih kategori yang ingin dilihat:\n\n` +
                `💰 **Top Saldo** - User dengan saldo terbesar\n` +
                `📦 **Top Orders** - User dengan order terbanyak\n\n` +
                `📊 Data diupdate real-time`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, topText, keyboard);

        } catch (error) {
            console.error('Show top users error:', error);
            await this.bot.editMessageText('❌ Error loading top users data', {
                chat_id: chatId,
                message_id: messageId
            });
        }
    }

    async showTopSaldo(chatId, messageId) {
        try {
            const users = await this.db.loadUsers();
            const topSaldo = users
                .filter(user => user.saldo > 0)
                .sort((a, b) => b.saldo - a.saldo)
                .slice(0, 10);

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'top_saldo' }],
                    [{ text: '🔙 Top Users', callback_data: 'top_users' }]
                ]
            };

            let saldoText = 'TOP SALDO USER\n\n';
            
            if (topSaldo.length > 0) {
                topSaldo.forEach((user, index) => {
                    const hiddenId = user.id.substring(0, 4) + 'xxx' + user.id.substring(user.id.length - 3);
                    const safeDate = String(user.date || 'Unknown').substring(0, 19);
                    
                    saldoText += (index + 1) + '. ID: ' + hiddenId + '\n';
                    saldoText += '   Saldo: Rp ' + user.saldo.toLocaleString('id-ID') + '\n';
                    saldoText += '   Tanggal: ' + safeDate + '\n\n';
                });
            } else {
                saldoText += 'Belum ada user dengan saldo.\n\n';
            }
            
            const timeInfo = this.getIndonesianTime();
            saldoText += 'Update: ' + timeInfo.date + ' ' + timeInfo.time;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, saldoText, keyboard);

        } catch (error) {
            console.error('Show top saldo error:', error);
            
            const errorKeyboard = {
                inline_keyboard: [[{ text: '🔙 Top Users', callback_data: 'top_users' }]]
            };
            
            await this.bot.editMessageText('Error loading top saldo. Silakan coba lagi', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: errorKeyboard
            });
        }
    }

    async showTopOrders(chatId, messageId) {
        try {
            const history = await this.db.loadHistory();
            
            const userOrderCounts = {};
            
            Object.keys(history).forEach(userIdStr => {
                const userOrders = history[userIdStr];
                if (userOrders && userOrders.length > 0) {
                    userOrderCounts[userIdStr] = {
                        count: userOrders.length,
                        totalSpent: userOrders.reduce((sum, order) => sum + (order.price || 0), 0)
                    };
                }
            });

            const topOrders = Object.entries(userOrderCounts)
                .sort(([,a], [,b]) => b.count - a.count)
                .slice(0, 10);

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'top_orders' }],
                    [{ text: '🔙 Top Users', callback_data: 'top_users' }]
                ]
            };

            const totalCustomers = Object.keys(history).length;
            const totalOrders = Object.values(history).reduce((sum, orders) => sum + orders.length, 0);
            const totalRevenue = Object.values(history).reduce((sum, orders) => {
                return sum + orders.reduce((orderSum, order) => orderSum + (order.price || 0), 0);
            }, 0);

            let ordersText = `📦 TOP ORDERS USER\n\n`;
            
            ordersText += `📊 Statistik:\n`;
            ordersText += `👥 Total Customers: ${totalCustomers}\n`;
            ordersText += `📋 Total Orders: ${totalOrders}\n`;
            ordersText += `💵 Total Revenue: Rp ${totalRevenue.toLocaleString('id-ID')}\n\n`;
            
            if (topOrders.length > 0) {
                ordersText += `🏆 Top 10 Customer:\n\n`;
                
                for (let index = 0; index < topOrders.length; index++) {
                    const [userIdStr, data] = topOrders[index];
                    const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
                    const hiddenId = userIdStr.substring(0, 4) + "xxx" + userIdStr.substring(userIdStr.length - 3);
                    
                    ordersText += `${medal} ID: ${hiddenId}\n`;
                    ordersText += `    📦 Total order: ${data.count}\n`;
                    ordersText += `    💰 Total spent: Rp ${data.totalSpent.toLocaleString('id-ID')}\n\n`;
                    
                    if (ordersText.length > 3500) {
                        ordersText += `... dan ${topOrders.length - index - 1} customer lainnya\n\n`;
                        break;
                    }
                }
                
            } else {
                ordersText += `📄 Belum ada data order.\n\n`;
            }
            
            const now = new Date();
            const jakartaTime = now.toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            ordersText += `🕐 Update: ${jakartaTime} WIB`;

            if (ordersText.length > 4000) {
                ordersText = ordersText.substring(0, 3900) + "\n\n... (data terpotong)";
            }

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, ordersText, keyboard);

        } catch (error) {
            console.error('Show top orders error:', error);
            
            const errorKeyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Top Users', callback_data: 'top_users' }]
                ]
            };
            
            try {
                await this.bot.editMessageText(
                    '❌ Error loading data\n\nData terlalu besar atau corrupt, hubungi admin @Jeeyhosting', 
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: errorKeyboard
                    }
                );
            } catch (fallbackError) {
                console.error('Fallback error message failed:', fallbackError);
            }
        }
    }

    async showOwnerPanel(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const users = await this.db.loadUsers();
        const orders = await this.db.loadOrders();
        const broadcastUsers = await this.db.loadBroadcastUsers();
        const pendingDeposits = await this.db.loadPendingManualDeposits();
        const products = await this.db.loadProducts();
        const productOrders = await this.db.loadProductOrders();
        const enabledProviders = this.providerManager.getEnabledProviders();
        
        const totalUsers = users.length;
        const totalBroadcastUsers = broadcastUsers.length;
        const totalSaldo = users.reduce((sum, user) => sum + user.saldo, 0);
        const activeOrders = Object.keys(orders).length;
        const pendingManualDeposits = pendingDeposits.filter(d => d.status === 'pending').length;
        const totalProducts = products.length;
        const pendingProductOrders = productOrders.filter(o => o.status === 'pending').length;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📊 User Statistics', callback_data: 'owner_stats' }],
                [{ text: '💰 Saldo Management', callback_data: 'owner_saldo' }],
                [{ text: '📋 Active Orders', callback_data: 'owner_orders' }],
                [{ text: '💳 Manual Deposits', callback_data: 'owner_manual_deposits' }],
                [{ text: '🛍️ Manage Products', callback_data: 'owner_products' }],
                [{ text: '📦 Product Orders', callback_data: 'owner_product_orders' }],
                [{ text: '🔙 Main Menu', callback_data: 'back_main' }]
            ]
        };

        const timeInfo = this.getIndonesianTime();

        const ownerText = `👑 *OWNER PANEL*\n\n` +
            `📊 *Bot Statistics:*\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `📡 Broadcast Users: ${totalBroadcastUsers}\n` +
            `💰 Total Saldo: Rp ${totalSaldo.toLocaleString('id-ID')}\n` +
            `📋 Active Orders: ${activeOrders}\n` +
            `💳 Pending Manual Deposits: ${pendingManualDeposits}\n` +
            `🛍️ Total Products: ${totalProducts}\n` +
            `📦 Pending Product Orders: ${pendingProductOrders}\n` +
            `🌐 Active Providers: ${enabledProviders.length}/20\n` +
            `📅 Tanggal: ${timeInfo.date}\n` +
            `🕐 Jam: ${timeInfo.time}\n\n` +
            `📝 *Owner Commands:*\n` +
            `\`/reff USER_ID AMOUNT\` - Add saldo to user\n` +
            `\`/bc TEXT\` - Broadcast text only\n` +
            `\`/produk_add\` - Tambah produk baru\n` +
            `\`/produk_list\` - Lihat daftar produk\n` +
            `\`/del USER_ID\` - Delete user\n` +
            `\`/info USER_ID\` - User info\n` +
            `Upload foto + \`/bc CAPTION\` - Broadcast foto + caption\n\n` +
            `💡 *Broadcast Examples:*\n` +
            `\`/bc Halo semuanya!\nBot maintenance 5 menit\nTerima kasih\`\n\n` +
            `Upload foto lalu caption:\n` +
            `\`/bc Promo hari ini!\nDiskon 50%\``;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, ownerText, keyboard);
    }

    async showOwnerStats(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }
        // ============================================
// 🔥 LANJUTAN src/index.js (dari baris ~2800)
// ============================================

        const users = await this.db.loadUsers();
        const broadcastUsers = await this.db.loadBroadcastUsers();
        const enabledProviders = this.providerManager.getEnabledProviders();
        
        const totalUsers = users.length;
        const usersWithBalance = users.filter(u => u.saldo > 0).length;
        const totalSaldo = users.reduce((sum, user) => sum + user.saldo, 0);
        const avgSaldo = totalUsers > 0 ? Math.round(totalSaldo / totalUsers) : 0;
        
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentUsers = users.filter(u => {
            if (!u.joinDate) return false;
            return new Date(u.joinDate) > weekAgo;
        }).length;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'owner_stats' }],
                [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
            ]
        };

        const timeInfo = this.getIndonesianTime();

        const statsText = `📊 *USER STATISTICS*\n\n` +
            `👥 *Total Users:* ${totalUsers}\n` +
            `📡 *Broadcast List:* ${broadcastUsers.length}\n` +
            `💰 *Users with Balance:* ${usersWithBalance}\n` +
            `💎 *Total Saldo:* Rp ${totalSaldo.toLocaleString('id-ID')}\n` +
            `📈 *Average Saldo:* Rp ${avgSaldo.toLocaleString('id-ID')}\n` +
            `🆕 *New Users (7 days):* ${recentUsers}\n` +
            `🌐 *Active Providers:* ${enabledProviders.length}/20\n\n` +
            `📅 Tanggal: ${timeInfo.date}\n` +
            `🕐 Jam: ${timeInfo.time}`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, statsText, keyboard);
    }

    async showOwnerSaldo(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const users = await this.db.loadUsers();
        
        const topUsers = users
            .filter(u => u.saldo > 0)
            .sort((a, b) => b.saldo - a.saldo)
            .slice(0, 10);

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'owner_saldo' }],
                [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
            ]
        };

        let saldoText = `💰 *SALDO MANAGEMENT*\n\n`;
        
        if (topUsers.length > 0) {
            saldoText += `💎 *Top ${topUsers.length} Users by Balance:*\n\n`;
            topUsers.forEach((user, index) => {
                saldoText += `${index + 1}. ID: \`${user.id}\` - Rp ${user.saldo.toLocaleString('id-ID')}\n`;
            });
        } else {
            saldoText += `📄 *No users with balance found.*\n`;
        }
        
        saldoText += `\n📝 *Commands:*\n`;
        saldoText += `\`/reff USER_ID AMOUNT\` - Add saldo\n\n`;
        
        const timeInfo = this.getIndonesianTime();
        saldoText += `📅 Tanggal: ${timeInfo.date}\n🕐 Jam: ${timeInfo.time}`;
        
        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, saldoText, keyboard);
    }

    async showOwnerOrders(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const orders = await this.db.loadOrders();
        const activeOrders = Object.keys(orders);

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'owner_orders' }],
                [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
            ]
        };

        let ordersText = `📋 *ACTIVE ORDERS MANAGEMENT*\n\n`;
        
        if (activeOrders.length > 0) {
            ordersText += `🔥 *Active Orders: ${activeOrders.length}*\n\n`;
            
            activeOrders.slice(0, 10).forEach((userIdKey, index) => {
                const order = orders[userIdKey];
                const elapsed = Math.floor((Date.now() - order.timestamp) / 60000);
                const providerConfig = order.providerKey ? this.config.PROVIDERS[order.providerKey] : null;
                const providerName = providerConfig ? `${providerConfig.emoji} ${providerConfig.name}` : 'Unknown';
                
                ordersText += `${index + 1}. User: \`${userIdKey}\`\n`;
                ordersText += `   📡 Server: ${providerName}\n`;
                ordersText += `   Service: ${order.serviceName}\n`;
                ordersText += `   Number: +${order.number}\n`;
                ordersText += `   Price: Rp ${order.price.toLocaleString('id-ID')}\n`;
                ordersText += `   Time: ${elapsed} min ago\n\n`;
            });
            
            if (activeOrders.length > 10) {
                ordersText += `... dan ${activeOrders.length - 10} orders lainnya\n\n`;
            }
        } else {
            ordersText += `✅ *No active orders*\n\n`;
        }
        
        const timeInfo = this.getIndonesianTime();
        ordersText += `📅 Tanggal: ${timeInfo.date}\n🕐 Jam: ${timeInfo.time}`;
        
        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, ordersText, keyboard);
    }

    async showOwnerManualDeposits(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const pendingDeposits = await this.db.loadPendingManualDeposits();
        const pending = pendingDeposits.filter(d => d.status === 'pending');

        const keyboard = {
            inline_keyboard: []
        };

        let depositsText = `💳 *MANUAL DEPOSITS*\n\n`;
        
        if (pending.length > 0) {
            depositsText += `⏰ *Pending Approvals: ${pending.length}*\n\n`;
            
            const displayPending = pending.slice(0, 3);
            
            displayPending.forEach((dep, index) => {
                depositsText += `${index + 1}. *${dep.fullName}*\n`;
                depositsText += `   🆔 Request: \`${dep.requestId}\`\n`;
                depositsText += `   👤 User ID: \`${dep.userId}\`\n`;
                depositsText += `   📱 Username: @${dep.username}\n`;
                depositsText += `   💰 Nominal: Rp ${dep.nominal.toLocaleString('id-ID')}\n`;
                depositsText += `   📅 Dibuat: ${dep.createdAt}\n\n`;
                
                const shortId = dep.requestId.split('-')[1] || dep.requestId.substring(0, 10);
                keyboard.inline_keyboard.push([
                    { text: `✅ #${index + 1}`, callback_data: `appr_man_${shortId}` },
                    { text: `❌ #${index + 1}`, callback_data: `rej_man_${shortId}` }
                ]);
            });
            
            if (pending.length > 3) {
                depositsText += `... dan ${pending.length - 3} request lainnya\n\n`;
            }
        } else {
            depositsText += `✅ *No pending deposits*\n\n`;
        }
        
        const timeInfo = this.getIndonesianTime();
        depositsText += `📅 Update: ${timeInfo.date} ${timeInfo.time}`;
        
        keyboard.inline_keyboard.push(
            [{ text: '🔄 Refresh', callback_data: 'owner_manual_deposits' }],
            [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
        );
        
        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, depositsText, keyboard);
    }

    async showOwnerProducts(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const products = await this.db.loadProducts();

        const keyboard = {
            inline_keyboard: []
        };

        let productsText = `🛍️ *PRODUCTS MANAGEMENT*\n\n`;
        
        if (products.length > 0) {
            productsText += `📦 *Total Products: ${products.length}*\n\n`;
            
            const displayProducts = products.slice(0, 3);
            
            displayProducts.forEach((prod, index) => {
                const paymentMethod = prod.paymentMethod === 'auto' ? '⚡ QRIS Auto' : 
                                    prod.paymentMethod === 'manual' ? '📸 Manual' : '🔄 Both';
                
                const dataType = prod.productData ? 
                    (prod.productData.type === 'file' ? `📄 File` : '📝 Text') :
                    '❌ No data';
                
                productsText += `${index + 1}. *${prod.name}*\n`;
                productsText += `   💰 Harga: Rp ${prod.price.toLocaleString('id-ID')}\n`;
                productsText += `   📦 Stock: ${prod.stock}\n`;
                productsText += `   💳 Metode: ${paymentMethod}\n`;
                productsText += `   📄 Data: ${dataType}\n`;
                productsText += `   🆔 ID: \`${prod.id}\`\n\n`;
                
                const shortId = prod.id.split('-')[1] || prod.id.substring(0, 10);
                keyboard.inline_keyboard.push([
                    { text: `🗑️ Del #${index + 1}`, callback_data: `del_prod_${shortId}` }
                ]);
            });
            
            if (products.length > 3) {
                productsText += `... dan ${products.length - 3} produk lainnya\n\n`;
            }
        } else {
            productsText += `📄 *Belum ada produk*\n\n`;
            productsText += `Gunakan \`/produk_add\` untuk menambah produk.\n\n`;
        }
        
        const timeInfo = this.getIndonesianTime();
        productsText += `📅 Update: ${timeInfo.date} ${timeInfo.time}`;
        
        keyboard.inline_keyboard.push(
            [{ text: '➕ Tambah Produk', callback_data: 'add_product_start' }],
            [{ text: '🔄 Refresh', callback_data: 'owner_products' }],
            [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
        );
        
        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, productsText, keyboard);
    }

    async showOwnerProductOrders(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await this.bot.editMessageText('❌ Access Denied', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const productOrders = await this.db.loadProductOrders();
        const pending = productOrders.filter(o => o.status === 'pending');
        const approved = productOrders.filter(o => o.status === 'approved' || o.status === 'completed');
        const rejected = productOrders.filter(o => o.status === 'rejected');

        const keyboard = {
            inline_keyboard: []
        };

        let ordersText = `📦 *PRODUCT ORDERS MANAGEMENT*\n\n`;
        ordersText += `⏳ Pending: ${pending.length}\n`;
        ordersText += `✅ Approved: ${approved.length}\n`;
        ordersText += `❌ Rejected: ${rejected.length}\n\n`;
        
        if (pending.length > 0) {
            ordersText += `⏳ *PENDING ORDERS:*\n\n`;
            
            const displayPending = pending.slice(0, 3);
            
            displayPending.forEach((order, index) => {
                ordersText += `${index + 1}. *${order.productName}*\n`;
                ordersText += `   🆔 Order: \`${order.orderId}\`\n`;
                ordersText += `   👤 User ID: \`${order.userId}\`\n`;
                ordersText += `   📱 Username: @${order.username}\n`;
                ordersText += `   💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n`;
                ordersText += `   📅 Dibuat: ${order.createdAt}\n\n`;
                
                const shortId = order.orderId.split('-')[1] || order.orderId.substring(0, 10);
                keyboard.inline_keyboard.push([
                    { text: `✅ #${index + 1}`, callback_data: `appr_prod_${shortId}` },
                    { text: `❌ #${index + 1}`, callback_data: `rej_prod_${shortId}` }
                ]);
            });
            
            if (pending.length > 3) {
                ordersText += `... dan ${pending.length - 3} order lainnya\n\n`;
            }
        } else {
            ordersText += `✅ *No pending product orders*\n\n`;
        }
        
        const timeInfo = this.getIndonesianTime();
        ordersText += `📅 Update: ${timeInfo.date} ${timeInfo.time}`;
        
        keyboard.inline_keyboard.push(
            [{ text: '🔄 Refresh', callback_data: 'owner_product_orders' }],
            [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
        );
        
        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, ordersText, keyboard);
    }

    async handleAddProductStart(chatId, messageId, userId) {
        if (userId !== this.config.OWNER_ID) {
            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                '❌ Access Denied',
                { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_main' }]] }
            );
            return;
        }

        await editPhotoCaption(
            this.bot,
            chatId,
            messageId,
            this.botLogo,
            `➕ *TAMBAH PRODUK BARU*\n\n` +
            `📝 Gunakan command untuk menambah produk:\n` +
            `\`/produk_add\`\n\n` +
            `Bot akan memandu Anda step by step untuk menambahkan produk baru.`,
            {
                inline_keyboard: [
                    [{ text: '🔙 Owner Panel', callback_data: 'owner_panel' }]
                ]
            }
        );
    }

    async approveProductPayment(chatId, messageId, data, userId, query) {
        if (userId !== this.config.OWNER_ID) {
            return;
        }

        let orderId;
        if (data.startsWith('approve_product_payment_')) {
            orderId = data.replace('approve_product_payment_', '');
        } else if (data.startsWith('appr_prod_')) {
            const shortId = data.replace('appr_prod_', '');
            const productOrders = await this.db.loadProductOrders();
            const foundOrder = productOrders.find(o => 
                o.orderId.includes(shortId) && o.status === 'pending'
            );
            orderId = foundOrder ? foundOrder.orderId : shortId;
        }

        try {
            const productOrders = await this.db.loadProductOrders();
            const orderIndex = productOrders.findIndex(o => o.orderId === orderId && o.status === 'pending');

            if (orderIndex === -1) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Order tidak ditemukan atau sudah diproses',
                    show_alert: true
                });
                return;
            }

            const order = productOrders[orderIndex];

            const products = await this.db.loadProducts();
            const productIndex = products.findIndex(p => p.id === order.productId);

            if (productIndex === -1) {
                await this.bot.sendMessage(chatId, '❌ Produk tidak ditemukan di database');
                return;
            }

            if (products[productIndex].stock <= 0) {
                await this.bot.sendMessage(chatId, '❌ Stock produk habis, tidak bisa approve');
                return;
            }

            products[productIndex].stock -= 1;
            await this.db.saveProducts(products);

            productOrders[orderIndex].status = 'approved';
            productOrders[orderIndex].approvedAt = this.getIndonesianTimestamp();
            productOrders[orderIndex].approvedBy = userId;
            await this.db.saveProductOrders(productOrders);

            const product = products[productIndex];
            const productData = product.productData;

            if (productData) {
                if (productData.type === 'file') {
                    await this.bot.sendDocument(order.userId, productData.fileId, {
                        caption: 
                            `✅ *PEMBELIAN BERHASIL!*\n\n` +
                            `🆔 Order ID: \`${order.orderId}\`\n` +
                            `📦 Produk: ${product.name}\n` +
                            `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n\n` +
                            `📄 Data produk di atas.\n\n` +
                            `Terima kasih!`,
                        parse_mode: 'Markdown'
                    });
                } else if (productData.type === 'text') {
                    await this.bot.sendMessage(order.userId,
                        `✅ *PEMBELIAN BERHASIL!*\n\n` +
                        `🆔 Order ID: \`${order.orderId}\`\n` +
                        `📦 Produk: ${product.name}\n` +
                        `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n\n` +
                        `📄 *Data Produk:*\n` +
                        `\`\`\`\n${productData.content}\n\`\`\`\n\n` +
                        `Terima kasih!`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                await this.bot.sendMessage(order.userId,
                    `✅ *PEMBAYARAN DISETUJUI!*\n\n` +
                    `🆔 Order ID: \`${order.orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n\n` +
                    `Produk akan dikirim manual oleh admin.\n` +
                    `Hubungi @Jeeyhosting`,
                    { parse_mode: 'Markdown' }
                );
            }

            await this.sendTestimonialNotification(
                product.name,
                order.price,
                order.username,
                order.orderId
            );
            
            await this.bot.sendMessage(chatId,
                `✅ *ORDER PRODUK APPROVED*\n\n` +
                `🆔 Order ID: \`${order.orderId}\`\n` +
                `👤 User ID: \`${order.userId}\`\n` +
                `📦 Produk: ${product.name}\n` +
                `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n` +
                `📦 Stock tersisa: ${products[productIndex].stock}\n\n` +
                `Data produk telah dikirim ke customer!`,
                { parse_mode: 'Markdown' }
            );

            await this.bot.answerCallbackQuery(query.id, {
                text: "✅ Order approved & data sent!"
            });

        } catch (error) {
            console.error('Approve product payment error:', error);
            await this.bot.sendMessage(chatId, '❌ Error approving product payment');
            await this.bot.answerCallbackQuery(query.id, {
                text: "❌ Error approving"
            });
        }
    }

    async rejectProductPayment(chatId, messageId, data, userId, query) {
        if (userId !== this.config.OWNER_ID) {
            return;
        }

        let orderId;
        if (data.startsWith('reject_product_payment_')) {
            orderId = data.replace('reject_product_payment_', '');
        } else if (data.startsWith('rej_prod_')) {
            const shortId = data.replace('rej_prod_', '');
            const productOrders = await this.db.loadProductOrders();
            const foundOrder = productOrders.find(o => 
                o.orderId.includes(shortId) && o.status === 'pending'
            );
            orderId = foundOrder ? foundOrder.orderId : shortId;
        }

        try {
            const productOrders = await this.db.loadProductOrders();
            const orderIndex = productOrders.findIndex(o => o.orderId === orderId && o.status === 'pending');

            if (orderIndex === -1) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Order tidak ditemukan atau sudah diproses',
                    show_alert: true
                });
                return;
            }

            const order = productOrders[orderIndex];

            productOrders[orderIndex].status = 'rejected';
            productOrders[orderIndex].rejectedAt = this.getIndonesianTimestamp();
            productOrders[orderIndex].rejectedBy = userId;
            await this.db.saveProductOrders(productOrders);

            await this.bot.sendMessage(chatId,
                `❌ *ORDER PRODUK REJECTED*\n\n` +
                `🆔 Order ID: \`${order.orderId}\`\n` +
                `👤 User ID: \`${order.userId}\`\n` +
                `📦 Produk: ${order.productName}\n` +
                `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n\n` +
                `User telah dinotifikasi.`,
                { parse_mode: 'Markdown' }
            );

            try {
                await this.bot.sendMessage(order.userId,
                    `❌ *PEMBAYARAN DITOLAK*\n\n` +
                    `🆔 Order ID: \`${order.orderId}\`\n` +
                    `📦 Produk: ${order.productName}\n` +
                    `💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n\n` +
                    `Maaf, pembayaran Anda ditolak.\n` +
                    `Hubungi @Jeeyhosting untuk info lebih lanjut.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (notifError) {
                console.log('Failed to notify user:', notifError.message);
            }

            await this.bot.answerCallbackQuery(query.id, {
                text: "✅ Order rejected"
            });

        } catch (error) {
            console.error('Reject product payment error:', error);
            await this.bot.sendMessage(chatId, '❌ Error rejecting product payment');
        }
    }

    async approveManualDeposit(chatId, messageId, data, userId, query) {
        if (userId !== this.config.OWNER_ID) {
            return;
        }

        let requestId;
        if (data.startsWith('approve_manual_')) {
            requestId = data.replace('approve_manual_', '');
        } else if (data.startsWith('appr_man_')) {
            const shortId = data.replace('appr_man_', '');
            const pendingDeposits = await this.db.loadPendingManualDeposits();
            const foundDeposit = pendingDeposits.find(d => 
                d.requestId.includes(shortId) && d.status === 'pending'
            );
            requestId = foundDeposit ? foundDeposit.requestId : shortId;
        }

        try {
            const pendingDeposits = await this.db.loadPendingManualDeposits();
            const depositIndex = pendingDeposits.findIndex(d => d.requestId === requestId && d.status === 'pending');

            if (depositIndex === -1) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Request tidak ditemukan atau sudah diproses',
                    show_alert: true
                });
                return;
            }

            const deposit = pendingDeposits[depositIndex];

            const refundResult = await this.updateUserSaldo(deposit.userId, deposit.nominal, 'add');

            if (refundResult.success) {
                pendingDeposits[depositIndex].status = 'approved';
                pendingDeposits[depositIndex].approvedAt = this.getIndonesianTimestamp();
                pendingDeposits[depositIndex].approvedBy = userId;
                await this.db.savePendingManualDeposits(pendingDeposits);

                await this.bot.sendMessage(chatId,
                    `✅ *DEPOSIT APPROVED*\n\n` +
                    `🆔 Request ID: \`${requestId}\`\n` +
                    `👤 User ID: \`${deposit.userId}\`\n` +
                    `📛 Nama: ${deposit.fullName}\n` +
                    `💰 Nominal: Rp ${deposit.nominal.toLocaleString('id-ID')}\n` +
                    `💳 Saldo baru: Rp ${refundResult.newSaldo.toLocaleString('id-ID')}\n\n` +
                    `Notifikasi telah dikirim ke user.`,
                    { parse_mode: 'Markdown' }
                );

                try {
                    await this.bot.sendMessage(deposit.userId,
                        `✅ *DEPOSIT APPROVED!*\n\n` +
                        `🆔 Request ID: \`${requestId}\`\n` +
                        `💰 Nominal: Rp ${deposit.nominal.toLocaleString('id-ID')}\n` +
                        `💳 Saldo baru: Rp ${refundResult.newSaldo.toLocaleString('id-ID')}\n\n` +
                        `Terima kasih! Saldo Anda sudah ditambahkan.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (notifError) {
                    console.log('Failed to notify user:', notifError.message);
                }

                await this.showOwnerManualDeposits(chatId, messageId, userId);
            }

        } catch (error) {
            console.error('Approve manual deposit error:', error);
            await this.bot.sendMessage(chatId, '❌ Error approving deposit');
        }
    }

    async rejectManualDeposit(chatId, messageId, data, userId, query) {
        if (userId !== this.config.OWNER_ID) {
            return;
        }

        let requestId;
        if (data.startsWith('reject_manual_')) {
            requestId = data.replace('reject_manual_', '');
        } else if (data.startsWith('rej_man_')) {
            const shortId = data.replace('rej_man_', '');
            const pendingDeposits = await this.db.loadPendingManualDeposits();
            const foundDeposit = pendingDeposits.find(d => 
                d.requestId.includes(shortId) && d.status === 'pending'
            );
            requestId = foundDeposit ? foundDeposit.requestId : shortId;
        }

        try {
            const pendingDeposits = await this.db.loadPendingManualDeposits();
            const depositIndex = pendingDeposits.findIndex(d => d.requestId === requestId && d.status === 'pending');

            if (depositIndex === -1) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Request tidak ditemukan atau sudah diproses',
                    show_alert: true
                });
                return;
            }

            const deposit = pendingDeposits[depositIndex];

            pendingDeposits[depositIndex].status = 'rejected';
            pendingDeposits[depositIndex].rejectedAt = this.getIndonesianTimestamp();
            pendingDeposits[depositIndex].rejectedBy = userId;
            await this.db.savePendingManualDeposits(pendingDeposits);

            await this.bot.sendMessage(chatId,
                `❌ *DEPOSIT REJECTED*\n\n` +
                `🆔 Request ID: \`${requestId}\`\n` +
                `👤 User ID: \`${deposit.userId}\`\n` +
                `📛 Nama: ${deposit.fullName}\n` +
                `💰 Nominal: Rp ${deposit.nominal.toLocaleString('id-ID')}\n\n` +
                `Notifikasi telah dikirim ke user.`,
                { parse_mode: 'Markdown' }
            );

            try {
                await this.bot.sendMessage(deposit.userId,
                    `❌ *DEPOSIT REJECTED*\n\n` +
                    `🆔 Request ID: \`${requestId}\`\n` +
                    `💰 Nominal: Rp ${deposit.nominal.toLocaleString('id-ID')}\n\n` +
                    `Maaf, request deposit Anda ditolak.\n` +
                    `Hubungi @Jeeyhosting untuk info lebih lanjut.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (notifError) {
                console.log('Failed to notify user:', notifError.message);
            }

            await this.showOwnerManualDeposits(chatId, messageId, userId);

        } catch (error) {
            console.error('Reject manual deposit error:', error);
            await this.bot.sendMessage(chatId, '❌ Error rejecting deposit');
        }
    }

    async deleteProduct(chatId, messageId, data, userId) {
        if (userId !== this.config.OWNER_ID) {
            return;
        }

        let productId;
        if (data.startsWith('delete_product_')) {
            productId = data.replace('delete_product_', '');
        } else if (data.startsWith('del_prod_')) {
            const shortId = data.replace('del_prod_', '');
            const products = await this.db.loadProducts();
            const foundProduct = products.find(p => p.id.includes(shortId));
            productId = foundProduct ? foundProduct.id : shortId;
        }

        try {
            const products = await this.db.loadProducts();
            const productIndex = products.findIndex(p => p.id === productId);

            if (productIndex === -1) {
                await this.bot.sendMessage(chatId, '❌ Produk tidak ditemukan');
                return;
            }

            const product = products[productIndex];
            products.splice(productIndex, 1);
            await this.db.saveProducts(products);

            await this.bot.sendMessage(chatId,
                `✅ *PRODUK DIHAPUS*\n\n` +
                `📦 Nama: ${product.name}\n` +
                `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                `🆔 ID: \`${productId}\``,
                { parse_mode: 'Markdown' }
            );

            await this.showOwnerProducts(chatId, messageId, userId);

        } catch (error) {
            console.error('Delete product error:', error);
            await this.bot.sendMessage(chatId, '❌ Error deleting product');
        }
    }

    async showProdukDigital(chatId, messageId, userId, page = 0) {
        try {
            const products = await this.db.loadProducts();
            const availableProducts = products.filter(p => p.stock > 0);

            const ITEMS_PER_PAGE = 5;
            const totalPages = Math.ceil(availableProducts.length / ITEMS_PER_PAGE);
            const startIndex = page * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const productsOnPage = availableProducts.slice(startIndex, endIndex);

            const keyboard = {
                inline_keyboard: []
            };

            if (availableProducts.length === 0) {
                const emptyText = `🛍️ *PRODUK DIGITAL*\n\n` +
                    `📦 Belum ada produk tersedia.\n\n` +
                    `Tunggu update dari admin!`;

                keyboard.inline_keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

                await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, emptyText, keyboard);
                return;
            }

            let produkText = `🛍️ *PRODUK DIGITAL* (Hal ${page + 1}/${totalPages})\n\n`;
            produkText += `Total ${availableProducts.length} produk tersedia.\n\n`;

            productsOnPage.forEach((prod, index) => {
                const number = startIndex + index + 1;
                produkText += `${number}. *${prod.name}*\n`;
                produkText += `   💰 Harga: Rp ${prod.price.toLocaleString('id-ID')}\n`;
                produkText += `   📦 Stock: ${prod.stock}\n`;
                produkText += `   📝 ${prod.description}\n\n`;

                const shortName = prod.name.length > 20 ? prod.name.substring(0, 20) + '...' : prod.name;
                keyboard.inline_keyboard.push([{
                    text: `🛒 ${shortName}`,
                    callback_data: `buy_product_${prod.id}`
                }]);
            });

            const navButtons = [];
            
            if (page > 0) {
                navButtons.push({
                    text: '⬅️ Prev',
                    callback_data: `produk_page_${page - 1}`
                });
            }
            
            if (totalPages > 1) {
                navButtons.push({
                    text: `${page + 1}/${totalPages}`,
                    callback_data: 'page_info'
                });
            }
            
            if (page < totalPages - 1) {
                navButtons.push({
                    text: 'Next ➡️',
                    callback_data: `produk_page_${page + 1}`
                });
            }
            
            if (navButtons.length > 0) {
                keyboard.inline_keyboard.push(navButtons);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, produkText, keyboard);

        } catch (error) {
            console.error('Show produk digital error:', error);
            const errorKeyboard = {
                inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
            };
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, '❌ Error loading products', errorKeyboard);
        }
    }

    async confirmProductPurchase(chatId, messageId, data, userId) {
        const productId = data.replace('buy_product_', '');

        try {
            const products = await this.db.loadProducts();
            const product = products.find(p => p.id === productId);

            if (!product) {
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ Produk tidak ditemukan',
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                );
                return;
            }

            if (product.stock <= 0) {
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ *Stock Habis*\n\nMaaf, produk ini sedang habis.',
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                );
                return;
            }

            const user = await this.getUser(userId);
            const currentSaldo = user ? user.saldo : 0;

            const keyboard = {
                inline_keyboard: []
            };

            if (product.paymentMethod === 'auto' || product.paymentMethod === 'both') {
                keyboard.inline_keyboard.push([
                    { text: '⚡ Bayar QRIS Otomatis', callback_data: `confirm_buy_product_${productId}_auto` }
                ]);
            }

            if (product.paymentMethod === 'manual' || product.paymentMethod === 'both') {
                keyboard.inline_keyboard.push([
                    { text: '📸 Bayar Manual (Upload Bukti)', callback_data: `confirm_buy_product_${productId}_manual` }
                ]);
            }

            if (currentSaldo >= product.price) {
                keyboard.inline_keyboard.push([
                    { text: '💰 Bayar Pakai Saldo', callback_data: `confirm_buy_product_${productId}_saldo` }
                ]);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'produk_digital' }]);

            const confirmText = `🛍️ *KONFIRMASI PEMBELIAN*\n\n` +
                `📦 Produk: *${product.name}*\n` +
                `📝 Deskripsi: ${product.description}\n` +
                `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                `📦 Stock: ${product.stock}\n\n` +
                `💳 Saldo Anda: Rp ${currentSaldo.toLocaleString('id-ID')}\n\n` +
                `Pilih metode pembayaran:`;

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, confirmText, keyboard);

        } catch (error) {
            console.error('Confirm product purchase error:', error);
            await this.bot.sendMessage(chatId, '❌ Error loading product');
        }
    }

    async processProductPurchase(chatId, messageId, data, userId, query) {
        const dataParts = data.replace('confirm_buy_product_', '').split('_');
        const productId = dataParts[0];
        const paymentMethod = dataParts[1];

        try {
            const products = await this.db.loadProducts();
            const productIndex = products.findIndex(p => p.id === productId);

            if (productIndex === -1) {
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ Produk tidak ditemukan',
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                );
                return;
            }

            const product = products[productIndex];

            if (product.stock <= 0) {
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    '❌ *Stock Habis*\n\nMaaf, produk habis saat Anda checkout.',
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                );
                return;
            }

            if (paymentMethod === 'saldo') {
                const user = await this.getUser(userId);
                
                if (!user || user.saldo < product.price) {
                    await editPhotoCaption(
                        this.bot,
                        chatId,
                        messageId,
                        this.botLogo,
                        `❌ *Saldo Tidak Cukup*\n\nSaldo Anda: Rp ${(user ? user.saldo : 0).toLocaleString('id-ID')}\n` +
                        `Dibutuhkan: Rp ${product.price.toLocaleString('id-ID')}`,
                        { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                    );
                    return;
                }

                const result = await this.updateUserSaldo(userId, product.price, 'subtract');

                if (!result.success) {
                    await editPhotoCaption(
                        this.bot,
                        chatId,
                        messageId,
                        this.botLogo,
                        '❌ Gagal memotong saldo',
                        { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                    );
                    return;
                }

                products[productIndex].stock -= 1;
                await this.db.saveProducts(products);

                const timeInfo = this.getIndonesianTime();
                const orderId = `PROD-${Date.now()}`;

                const productData = product.productData;
                if (productData) {
                    if (productData.type === 'file') {
                        await this.bot.sendDocument(userId, productData.fileId, {
                            caption: 
                                `✅ *PEMBELIAN BERHASIL!*\n\n` +
                                `🆔 Order ID: \`${orderId}\`\n` +
                                `📦 Produk: ${product.name}\n` +
                                `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                                `💳 Saldo tersisa: Rp ${result.newSaldo.toLocaleString('id-ID')}\n` +
                                `📅 Tanggal: ${timeInfo.date}\n` +
                                `🕐 Jam: ${timeInfo.time}\n\n` +
                                `📄 Data produk di atas.\n\n` +
                                `Terima kasih!`,
                            parse_mode: 'Markdown'
                        });
                    } else if (productData.type === 'text') {
                        await this.bot.sendMessage(userId,
                            `✅ *PEMBELIAN BERHASIL!*\n\n` +
                            `🆔 Order ID: \`${orderId}\`\n` +
                            `📦 Produk: ${product.name}\n` +
                            `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                            `💳 Saldo tersisa: Rp ${result.newSaldo.toLocaleString('id-ID')}\n` +
                            `📅 Tanggal: ${timeInfo.date}\n` +
                            `🕐 Jam: ${timeInfo.time}\n\n` +
                            `📄 *Data Produk:*\n` +
                            `\`\`\`\n${productData.content}\n\`\`\`\n\n` +
                            `Terima kasih!`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }

                const successText = `✅ *PEMBELIAN BERHASIL!*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `💳 Saldo tersisa: Rp ${result.newSaldo.toLocaleString('id-ID')}\n` +
                    `📅 Tanggal: ${timeInfo.date}\n` +
                    `🕐 Jam: ${timeInfo.time}\n\n` +
                    `📦 Data produk telah dikirim!`;

                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    successText,
                    { inline_keyboard: [[{ text: '🛍️ Belanja Lagi', callback_data: 'produk_digital' }]] }
                );

                const productOrders = await this.db.loadProductOrders();
                const username = await this.getUsernameDisplay(userId);
                const fullName = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
                productOrders.push({
                    orderId: orderId,
                    userId: userId.toString(),
                    username: username,
                    fullName: fullName,
                    productId: productId,
                    productName: product.name,
                    price: product.price,
                    status: 'completed',
                    paymentMethod: 'saldo',
                    completedAt: this.getIndonesianTimestamp(),
                    timeInfo: timeInfo
                });
                await this.db.saveProductOrders(productOrders);

                try {
                    await this.sendTestimonialNotification(
                        product.name,
                        product.price,
                        username,
                        orderId
                    );
                    
                    await this.bot.sendMessage(this.config.OWNER_ID,
                        `🛍️ *PEMBELIAN PRODUK BARU*\n\n` +
                        `🆔 Order ID: \`${orderId}\`\n` +
                        `👤 User ID: \`${userId}\`\n` +
                        `📱 Username: @${username}\n` +
                        `📦 Produk: ${product.name}\n` +
                        `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                        `💳 Metode: Saldo\n` +
                        `📅 Waktu: ${timeInfo.date} ${timeInfo.time}\n\n` +
                        `✅ Data produk sudah dikirim otomatis ke customer!`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (notifError) {
                    console.log('Failed to notify owner:', notifError.message);
                }

            } else if (paymentMethod === 'auto') {
                const reff_id = `prod-${userId}-${Date.now()}`;

                try {
                    const params = new URLSearchParams({
                        nominal: product.price.toString(),
                        metode: 'QRISFAST'
                    });

                    const res = await axios.get(`${this.config.CIAATOPUP_CREATE_URL}?${params}`, {
                        headers: { 
                            'X-APIKEY': this.config.CIAATOPUP_API_KEY,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    });

                    if (!res.data || res.data.success !== true || !res.data.data || !res.data.data.qr_string) {
                        await this.bot.sendMessage(chatId, "❌ Gagal membuat pembayaran.");
                        return;
                    }

                    const qrData = res.data.data;
                    const qrBuffer = await QRCode.toBuffer(qrData.qr_string);

                    const teks = `🛍️ *PEMBAYARAN PRODUK*\n\n` +
                        `📦 Produk: ${product.name}\n` +
                        `🆔 Transaksi ID: \`${qrData.id}\`\n` +
                        `💰 Harga: Rp ${product.price.toLocaleString("id-ID")}\n` +
                        `🧾 Biaya Admin: Rp ${qrData.fee.toLocaleString("id-ID")}\n` +
                        `💸 Total Bayar: Rp ${qrData.nominal.toLocaleString("id-ID")}\n` +
                        `📅 Expired: ${qrData.expired_at}\n\n` +
                        `📲 Scan QR dengan DANA/OVO/GoPay/ShopeePay\n\n` +
                        `📦 Data produk akan dikirim otomatis setelah pembayaran.`;

                    const sent = await this.bot.sendPhoto(chatId, qrBuffer, {
                        caption: teks,
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "❌ BATAL", callback_data: `cancel_deposit_${qrData.id}` }]
                            ]
                        }
                    });

                    this.autoPending.push({
                        id: chatId,
                        trx_id: qrData.id,
                        get_balance: qrData.get_balance,
                        user_name: query.from.first_name,
                        done: false,
                        msgId: sent.message_id,
                        startTime: Date.now(),
                        productId: productId,
                        isProduct: true
                    });

                } catch (err) {
                    console.log("❌ ERROR PRODUCT PAYMENT:", err.message);
                    this.bot.sendMessage(chatId, "❌ Terjadi kesalahan saat membuat pembayaran.");
                }

            } else if (paymentMethod === 'manual') {
                await this.showManualPaymentMethods(chatId, messageId, productId, product, userId, query);
            }

        } catch (error) {
            console.error('Process product purchase error:', error);
            await this.bot.sendMessage(chatId, '❌ Error processing purchase');
        }
    }

    async showManualPaymentMethods(chatId, messageId, productId, product, userId, query) {
        try {
            const manualPayment = this.config.MANUAL_PAYMENT;
            const keyboard = {
                inline_keyboard: []
            };

            if (manualPayment.QRIS && manualPayment.QRIS.enabled) {
                keyboard.inline_keyboard.push([{
                    text: '📱 QRIS',
                    callback_data: `manual_pay_${productId}_qris`
                }]);
            }
            if (manualPayment.DANA && manualPayment.DANA.enabled) {
                keyboard.inline_keyboard.push([{
                    text: '💳 DANA',
                    callback_data: `manual_pay_${productId}_dana`
                }]);
            }
            if (manualPayment.OVO && manualPayment.OVO.enabled) {
                keyboard.inline_keyboard.push([{
                    text: '💳 OVO',
                    callback_data: `manual_pay_${productId}_ovo`
                }]);
            }
            if (manualPayment.GOPAY && manualPayment.GOPAY.enabled) {
                keyboard.inline_keyboard.push([{
                    text: '💳 GOPAY',
                    callback_data: `manual_pay_${productId}_gopay`
                }]);
            }
            if (manualPayment.BCA && manualPayment.BCA.enabled) {
                keyboard.inline_keyboard.push([{
                    text: '🏦 BCA',
                    callback_data: `manual_pay_${productId}_bca`
                }]);
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'produk_digital' }]);

            await editPhotoCaption(
                this.bot,
                chatId,
                messageId,
                this.botLogo,
                `📸 *PILIH METODE PEMBAYARAN MANUAL*\n\n` +
                `📦 Produk: ${product.name}\n` +
                `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                `Pilih metode pembayaran yang tersedia:`,
                keyboard
            );
        } catch (error) {
            console.error('Show manual payment methods error:', error);
            await this.bot.sendMessage(chatId, '❌ Error showing payment methods');
        }
    }

    async handleManualPaymentSelection(chatId, messageId, data, userId, query) {
        try {
            const dataParts = data.replace('manual_pay_', '').split('_');
            const productId = dataParts[0];
            const paymentMethod = dataParts[1];

            const products = await this.db.loadProducts();
            const product = products.find(p => p.id === productId);

            if (!product) {
                await this.bot.sendMessage(chatId, '❌ Produk tidak ditemukan');
                return;
            }

            const orderId = `PORD-${Date.now()}`;
            const username = await this.getUsernameDisplay(userId);
            const fullName = query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '');
            const timeInfo = this.getIndonesianTime();

            const productOrders = await this.db.loadProductOrders();
            productOrders.push({
                orderId: orderId,
                userId: userId.toString(),
                username: username,
                fullName: fullName,
                productId: productId,
                productName: product.name,
                price: product.price,
                status: 'pending',
                paymentType: 'manual',
                paymentMethod: paymentMethod.toUpperCase(),
                createdAt: this.getIndonesianTimestamp(),
                timeInfo: timeInfo
            });
            await this.db.saveProductOrders(productOrders);

            this.paymentProofStates.set(userId, {
                orderId: orderId,
                productId: productId,
                productName: product.name,
                price: product.price,
                paymentMethod: paymentMethod,
                createdAt: timeInfo
            });

            const manualPayment = this.config.MANUAL_PAYMENT;
            let paymentText = '';
            let paymentPhoto = null;

            if (paymentMethod === 'qris' && manualPayment.QRIS) {
                paymentPhoto = manualPayment.QRIS.image_url;
                paymentText = `📱 *PEMBAYARAN VIA QRIS*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                    `📲 *Cara Bayar:*\n` +
                    `1. Scan QR Code di atas\n` +
                    `2. Bayar sejumlah Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `3. Screenshot bukti pembayaran\n` +
                    `4. Upload bukti ke chat ini\n\n` +
                    `⏳ Menunggu bukti pembayaran...`;
            } else if (paymentMethod === 'dana' && manualPayment.DANA) {
                paymentText = `💳 *PEMBAYARAN VIA DANA*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                    `📱 *Nomor DANA:*\n` +
                    `\`${manualPayment.DANA.number}\`\n` +
                    `📛 A.n: ${manualPayment.DANA.name}\n\n` +
                    `📲 *Cara Bayar:*\n` +
                    `1. Buka aplikasi DANA\n` +
                    `2. Transfer ke nomor di atas\n` +
                    `3. Nominal: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `4. Screenshot bukti transfer\n` +
                    `5. Upload bukti ke chat ini\n\n` +
                    `⏳ Menunggu bukti pembayaran...`;
            } else if (paymentMethod === 'ovo' && manualPayment.OVO) {
                paymentText = `💳 *PEMBAYARAN VIA OVO*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                    `📱 *Nomor OVO:*\n` +
                    `\`${manualPayment.OVO.number}\`\n` +
                    `📛 A.n: ${manualPayment.OVO.name}\n\n` +
                    `📲 *Cara Bayar:*\n` +
                    `1. Buka aplikasi OVO\n` +
                    `2. Transfer ke nomor di atas\n` +
                    `3. Nominal: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `4. Screenshot bukti transfer\n` +
                    `5. Upload bukti ke chat ini\n\n` +
                    `⏳ Menunggu bukti pembayaran...`;
            } else if (paymentMethod === 'gopay' && manualPayment.GOPAY) {
                paymentText = `💳 *PEMBAYARAN VIA GOPAY*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                    `📱 *Nomor GOPAY:*\n` +
                    `\`${manualPayment.GOPAY.number}\`\n` +
                    `📛 A.n: ${manualPayment.GOPAY.name}\n\n` +
                    `📲 *Cara Bayar:*\n` +
                    `1. Buka aplikasi Gojek\n` +
                    `2. Transfer ke nomor di atas\n` +
                    `3. Nominal: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `4. Screenshot bukti transfer\n` +
                    `5. Upload bukti ke chat ini\n\n` +
                    `⏳ Menunggu bukti pembayaran...`;
            } else if (paymentMethod === 'bca' && manualPayment.BCA) {
                paymentText = `🏦 *PEMBAYARAN VIA BCA*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n\n` +
                    `🏦 *Rekening BCA:*\n` +
                    `\`${manualPayment.BCA.account_number}\`\n` +
                    `📛 A.n: ${manualPayment.BCA.account_name}\n\n` +
                    `📲 *Cara Bayar:*\n` +
                    `1. Transfer via Mobile/Internet Banking\n` +
                    `2. Ke rekening BCA di atas\n` +
                    `3. Nominal: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `4. Screenshot bukti transfer\n` +
                    `5. Upload bukti ke chat ini\n\n` +
                    `⏳ Menunggu bukti pembayaran...`;
            }

            if (paymentMethod === 'qris' && paymentPhoto) {
                try {
                    await this.bot.deleteMessage(chatId, messageId);
                } catch (e) {}
                
                await this.bot.sendPhoto(chatId, paymentPhoto, {
                    caption: paymentText,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]]
                    }
                });
            } else {
                await editPhotoCaption(
                    this.bot,
                    chatId,
                    messageId,
                    this.botLogo,
                    paymentText,
                    { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]] }
                );
            }

            try {
                await this.bot.sendMessage(this.config.OWNER_ID,
                    `📦 *ORDER PRODUK MANUAL BARU*\n\n` +
                    `🆔 Order ID: \`${orderId}\`\n` +
                    `👤 User ID: \`${userId}\`\n` +
                    `📛 Nama: ${fullName}\n` +
                    `📱 Username: @${username}\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `💳 Metode: ${paymentMethod.toUpperCase()}\n` +
                    `📅 Waktu: ${timeInfo.date} ${timeInfo.time}\n\n` +
                    `⏳ Tunggu user upload bukti transfer.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (notifError) {
                console.log('Failed to notify owner:', notifError.message);
            }

        } catch (error) {
            console.error('Handle manual payment selection error:', error);
            await this.bot.sendMessage(chatId, '❌ Error processing payment method');
        }
    }

    async showProductHistory(chatId, messageId, userId) {
        try {
            const productOrders = await this.db.loadProductOrders();
            const userOrders = productOrders.filter(order => order.userId === userId.toString());

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 Menu Utama', callback_data: 'back_main' }]
                ]
            };

            if (userOrders.length === 0) {
                const emptyText = `📜 *RIWAYAT PRODUK DIGITAL*\n\n` +
                    `Belum ada riwayat pembelian produk.\n\n` +
                    `Silakan beli produk di menu 🛍️ Produk Digital.`;

                await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, emptyText, keyboard);
                return;
            }

            let historyText = `📜 *RIWAYAT PRODUK DIGITAL*\n\n`;
            historyText += `Total: ${userOrders.length} pembelian\n\n`;

            const completedOrders = userOrders.filter(o => o.status === 'completed' || o.status === 'approved');
            const pendingOrders = userOrders.filter(o => o.status === 'pending');
            const rejectedOrders = userOrders.filter(o => o.status === 'rejected');

            historyText += `✅ Selesai: ${completedOrders.length}\n`;
            historyText += `⏳ Pending: ${pendingOrders.length}\n`;
            historyText += `❌ Ditolak: ${rejectedOrders.length}\n\n`;
            historyText += `━━━━━━━━━━━━━━━━\n\n`;

            userOrders.slice(0, 8).forEach((order, index) => {
                const statusIcon = (order.status === 'completed' || order.status === 'approved') ? '✅' : 
                                  order.status === 'pending' ? '⏳' : '❌';
                const statusText = (order.status === 'completed' || order.status === 'approved') ? 'Selesai' : 
                                  order.status === 'pending' ? 'Pending' : 'Ditolak';

                historyText += `${index + 1}. ${statusIcon} *${order.productName}*\n`;
                historyText += `   💰 Harga: Rp ${order.price.toLocaleString('id-ID')}\n`;
                historyText += `   📝 Status: ${statusText}\n`;
                historyText += `   📅 ${order.timeInfo ? order.timeInfo.date : 'N/A'} ${order.timeInfo ? order.timeInfo.time : ''}\n`;
                historyText += `   🆔 \`${order.orderId}\`\n\n`;
            });

            if (userOrders.length > 8) {
                historyText += `\n... dan ${userOrders.length - 8} pembelian lainnya`;
            }

            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, historyText, keyboard);

        } catch (error) {
            console.error('Show product history error:', error);
            const errorKeyboard = {
                inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
            };
            await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, '❌ Error loading product history', errorKeyboard);
        }
    }

    async showMainMenu(chatId, messageId, userId) {
        const user = await this.getUser(userId);
        const saldoDisplay = user ? user.saldo.toLocaleString('id-ID') : '0';
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🛍️ Produk Digital', callback_data: 'produk_digital' },
                    { text: '💰 Cek Saldo', callback_data: 'check_balance' }
                ],
                [
                    { text: '📜 Riwayat Pembelian', callback_data: 'product_history' },
                    { text: '💳 Top Up', callback_data: 'topup' }
                ],
                [
                    { text: '🏆 Top Users', callback_data: 'top_users' },
                    { text: '📜 Syarat & Ketentuan', callback_data: 'rules' }
                ],
                [
                    { text: 'ℹ️ Bantuan', callback_data: 'help' }
                ]
            ]
        };

        if (userId === this.config.OWNER_ID) {
            keyboard.inline_keyboard.push([
                { text: '👑 Owner Panel', callback_data: 'owner_panel' }
            ]);
        }

        const uniqueUsers = await this.loadUniqueUsers();
        const usersWithBalance = await this.getUsersWithBalance();
        const timeInfo = this.getIndonesianTime();
        
        const sanitizeUsername = (username) => {
            if (!username || username === 'Tidak ada') return username;
            return username.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        };

        const usernameDisplay = await this.getUsernameDisplay(userId);
        const safeUsername = sanitizeUsername(usernameDisplay);

        const mainText = `🛍️ *MARKETPLACE PRODUK DIGITAL*\n\n` +
            `👤 *Info Akun:*\n` +
            `Username: ${usernameDisplay !== 'Tidak ada' ? '@' + safeUsername : 'Tidak ada'}\n` +
            `ID: \`${userId}\`\n` +
            `📅 Tanggal: ${timeInfo.date}\n` +
            `🕐 Jam: ${timeInfo.time}\n\n` +
            `💰 Saldo: *Rp ${saldoDisplay}*\n\n` +
            `📊 *Statistik Platform:*\n` +
            `👥 Total User: ${uniqueUsers.length}\n` +
            `💳 Total Member Aktif: ${usersWithBalance.length}\n\n` +
            `🚀 *Fitur Unggulan:*\n` +
            `✅ Produk digital unlimited storage (5TB+ ready)\n` +
            `✅ Payment otomatis (QRIS & Manual)\n` +
            `✅ Produk langsung terkirim otomatis\n` +
            `✅ Support 24/7\n` +
            `✅ Database anti-tamper & secure\n` +
            `✅ Auto-refund jika gagal\n\n` +
            `⚠️ *PENTING:*\n` +
            `• Pastikan saldo mencukupi sebelum membeli\n` +
            `• Produk akan langsung dikirim setelah pembayaran\n` +
            `• Saldo yang sudah diisi TIDAK BISA di-refund\n\n` +
            `👨‍💻 *Bot Creator:* @Jeeyhosting\n\n` +
            `Pilih menu di bawah untuk mulai:`;

        await editPhotoCaption(this.bot, chatId, messageId, this.botLogo, mainText, keyboard);
    }

    async addUserToBroadcastList(userId) {
        try {
            const users = await this.db.loadBroadcastUsers();
            const userIdNum = parseInt(userId);
            
            const existingIndex = users.indexOf(userIdNum);
            if (existingIndex === -1) {
                users.push(userIdNum);
                await this.db.saveBroadcastUsers(users);
                console.log(`✅ Added user ${userIdNum} to broadcast list. Total users: ${users.length}`);
            }
        } catch (error) {
            console.error('Error adding user to broadcast list:', error);
        }
    }

    async loadUniqueUsers() {
        try {
            const users = await this.db.loadBroadcastUsers();
            return [...new Set(users)];
        } catch (error) {
            return [];
        }
    }

    async getUsersWithBalance() {
        try {
            const users = await this.db.loadUsers();
            const usersWithBalance = users.filter(user => user.saldo >= 100);
            return usersWithBalance;
        } catch (error) {
            return [];
        }
    }

    async getUser(userId) {
        const users = await this.db.loadUsers();
        return users.find(user => user.id === userId.toString());
    }

    async updateUserSaldo(userId, amount, operation = 'add') {
        try {
            const users = await this.db.loadUsers();
            const userIndex = users.findIndex(u => u.id === userId.toString());
            
            if (userIndex === -1) {
                return { success: false, message: 'User not found' };
            }
            
            const oldSaldo = users[userIndex].saldo;
            
            if (operation === 'add') {
                users[userIndex].saldo += amount;
            } else if (operation === 'subtract') {
                if (users[userIndex].saldo < amount) {
                    return { success: false, message: 'Insufficient balance' };
                }
                users[userIndex].saldo -= amount;
            }
            
            users[userIndex].date = this.getIndonesianTimestamp();
            await this.db.saveUsers(users);
            
            return { 
                success: true, 
                newSaldo: users[userIndex].saldo,
                oldSaldo: oldSaldo
            };
        } catch (error) {
            console.error('Update user saldo error:', error);
            return { success: false, message: 'System error' };
        }
    }

    async addToHistory(userId, orderData, smsCode) {
        try {
            const history = await this.db.loadHistory();
            
            if (!history[userId]) {
                history[userId] = [];
            }
            
            const timeInfo = this.getIndonesianTime();
            
            const historyEntry = {
                orderId: orderData.orderId,
                number: orderData.number,
                serviceName: orderData.serviceName,
                country: orderData.country,
                price: orderData.price,
                smsCode: smsCode,
                timestamp: Date.now(),
                completedAt: `${timeInfo.date} ${timeInfo.time}`,
                providerKey: orderData.providerKey
            };
            
            history[userId].unshift(historyEntry);
            
            if (history[userId].length > 20) {
                history[userId] = history[userId].slice(0, 20);
            }
            
            await this.db.saveHistory(history);
            
            await this.updateTopOrders(userId);
            
            console.log(`✅ Added order ${orderData.orderId} to history for user ${userId}`);
        } catch (error) {
            console.error('Error adding to history:', error);
        }
    }

    async updateTopOrders(userId) {
        try {
            const top = await this.db.loadTop();
            const userIndex = top.findIndex(user => user.id === userId);
            
            if (userIndex !== -1) {
                top[userIndex].count += 1;
            } else {
                top.push({
                    id: userId,
                    count: 1,
                    username: await this.getUsernameDisplay(userId)
                });
            }
            
            await this.db.saveTop(top);
        } catch (error) {
            console.error('Error updating top orders:', error);
        }
    }

    async getUserName(userId) {
        try {
            const chatInfo = await this.bot.getChat(userId);
            return chatInfo.first_name + (chatInfo.last_name ? " " + chatInfo.last_name : "");
        } catch (error) {
            return "Customer";
        }
    }

    async getUsernameDisplay(userId) {
        try {
            const chatInfo = await this.bot.getChat(userId);
            return chatInfo.username || 'Tidak ada';
        } catch (error) {
            return 'Tidak ada';
        }
    }

    async sendTestimoniToChannel(orderData, smsCode) {
        try {
            const now = new Date();
            const waktu = now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            const userName = orderData.userName || "Customer";
            const providerConfig = orderData.providerKey ? this.config.PROVIDERS[orderData.providerKey] : null;
            const providerName = providerConfig ? `${providerConfig.emoji} ${providerConfig.name}` : 'Unknown Server';
            
            const hiddenNumber = orderData.number.substring(0, 4) + "***" + orderData.number.substring(orderData.number.length - 3);
            const hiddenOTP = smsCode.substring(0, 2) + "***" + smsCode.substring(smsCode.length - 1);

            const testimoniText = `🎉 *TRANSAKSI BERHASIL* 🎉\n\n` +
                `👤 Customer: ${userName}\n` +
                `📡 Server: ${providerName}\n` +
                `📧 Layanan: ${orderData.serviceName}\n` +
                `🌍 Negara: ${orderData.country}\n` +
                `📱 Nomor: +${hiddenNumber}\n` +
                `🔑 Kode: ${hiddenOTP}\n` +
                `💰 Harga: Rp ${orderData.price.toLocaleString('id-ID')}\n` +
                `⚡ Status: Sukses Instan\n` +
                `📅 Waktu: ${waktu}\n\n` +
                `🤖 *Multi-Provider System 24/7*\n` +
                `✅ Proses cepat & aman\n` +
                `✅ SMS masuk langsung\n` +
                `✅ Refund otomatis jika gagal\n` +
                `🌐 20 Providers tersedia\n\n` +
                `📞 Order sekarang juga!`;

            await this.bot.sendMessage(this.config.TESTIMONI_CHANNEL, testimoniText, {
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('Error sending testimoni to channel:', error.message);
        }
    }

    getIndonesianTimestamp() {
        const now = new Date();
        const options = {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        
        const jakartaTime = now.toLocaleString('id-ID', options);
        return jakartaTime.replace(', ', ' ');
    }

    getIndonesianTime() {
        const now = new Date();
        const options = {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        
        const jakartaTime = now.toLocaleString('id-ID', options);
        const [date, time] = jakartaTime.split(' ');
        
        return {
            date: date,
            time: time,
            full: jakartaTime,
            dateOnly: date,
            timeOnly: time
        };
    }

    async checkBanned(userId) {
        try {
            const bannedUsers = await this.db.loadBannedUsers();
            const banned = bannedUsers.find(b => b.userId === userId.toString());
            if (banned) {
                return {
                    banned: true,
                    reason: banned.reason || 'Pelanggaran kebijakan',
                    bannedAt: banned.bannedAt || 'N/A'
                };
            }
            return { banned: false };
        } catch (error) {
            console.error('Ban check error:', error);
            return { banned: false };
        }
    }

    async checkRateLimit(userId, action = 'general') {
        try {
            const rateLimit = await this.db.loadRateLimit();
            const userKey = `${userId}_${action}`;
            const now = Date.now();
            
            if (!rateLimit[userKey]) {
                rateLimit[userKey] = { count: 1, firstRequest: now, lastRequest: now };
                await this.db.saveRateLimit(rateLimit);
                return { limited: false };
            }

            const timeDiff = now - rateLimit[userKey].firstRequest;
            
            if (timeDiff < 10000) {
                rateLimit[userKey].count++;
                
                if (rateLimit[userKey].count > 15) {
                    rateLimit[userKey].lastRequest = now;
                    await this.db.saveRateLimit(rateLimit);
                    
                    console.warn(`⚠️ Rate limit exceeded for user ${userId} on action ${action}`);
                    return {
                        limited: true,
                        message: '⚠️ Terlalu banyak request! Tunggu beberapa detik.'
                    };
                }
            } else {
                rateLimit[userKey] = { count: 1, firstRequest: now, lastRequest: now };
            }

            rateLimit[userKey].lastRequest = now;
            await this.db.saveRateLimit(rateLimit);
            return { limited: false };

        } catch (error) {
            console.error('Rate limit check error:', error);
            return { limited: false };
        }
    }

    validateInput(input, type = 'text', maxLength = 500) {
        if (!input || typeof input !== 'string') {
            return { valid: false, error: 'Input tidak valid' };
        }

        const trimmed = input.trim();
        
        if (trimmed.length === 0) {
            return { valid: false, error: 'Input tidak boleh kosong' };
        }

        if (trimmed.length > maxLength) {
            return { valid: false, error: `Input terlalu panjang (max ${maxLength} karakter)` };
        }

        const dangerous = /<script|javascript:|onerror=|onclick=/i;
        if (dangerous.test(trimmed)) {
            return { valid: false, error: 'Input mengandung karakter berbahaya' };
        }

        if (type === 'number') {
            const num = parseInt(trimmed);
            if (isNaN(num)) {
                return { valid: false, error: 'Harus berupa angka' };
            }
        }

        return { valid: true, value: trimmed };
    }

    async sendTestimonialNotification(productName, price, buyerUsername, orderId) {
        try {
            const timeInfo = this.getIndonesianTime();
            const testimonialText = `🎉 *PEMBELIAN BARU!*\n\n` +
                `📦 Produk: ${productName}\n` +
                `💰 Harga: Rp ${price.toLocaleString('id-ID')}\n` +
                `👤 Pembeli: @${buyerUsername || 'anonymous'}\n` +
                `🆔 Order ID: \`${orderId}\`\n` +
                `📅 Waktu: ${timeInfo.date} ${timeInfo.time}\n\n` +
                `✅ Transaksi berhasil diproses!\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🤖 @Jeeyhosting`;

            await this.bot.sendMessage(this.config.TESTIMONI_CHANNEL, testimonialText, {
                parse_mode: 'Markdown'
            });
            
            console.log(`✅ Testimonial sent for order ${orderId}`);
        } catch (error) {
            console.error('Failed to send testimonial notification:', error);
        }
    }
}

// ============================================
// 🚀 START BOT
// ============================================
(async () => {
    const bot = new VirtuSIMBot();
    await bot.initPromise;
    console.log('🚀 Multi-Provider SMS Bot fully started!');
    console.log('🌐 Ready to serve with 20 providers!');
    
    process.on('SIGINT', () => {
        console.log('🛑 Bot shutting down...');
        bot.activeMonitors.forEach(monitor => clearInterval(monitor));
        bot.userLocks.clear();
        bot.pendingOrders.clear();
        bot.refundLocks.clear();
        process.exit(0);
    });
})();
