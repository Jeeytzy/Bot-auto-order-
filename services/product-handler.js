const logger = require('./logger');
const security = require('./security');
const validation = require('./validation');
const storage = require('./storage');
const notifications = require('./notifications');

class ProductHandler {
    constructor(bot, config, db, enhancedDb) {
        this.bot = bot;
        this.config = config;
        this.db = db;
        this.enhancedDb = enhancedDb;
        this.productAddStates = new Map();
    }

    async handleProdukAdd(msg) {
        const senderId = msg.from.id;
        const chatId = msg.chat.id;

        // Owner-only check
        if (senderId !== this.config.OWNER_ID) {
            logger.logSecurityEvent('unauthorized_product_add', senderId);
            return this.bot.sendMessage(chatId, 
                "❌ *Access Denied*\n\nCommand ini hanya untuk owner bot.", 
                { parse_mode: 'Markdown' }
            );
        }

        // Security check
        const accessCheck = await security.validateAccess(senderId, 'produk_add');
        if (!accessCheck.allowed) {
            return this.bot.sendMessage(chatId, accessCheck.message);
        }

        this.productAddStates.set(senderId, {
            step: 'name',
            data: {}
        });

        logger.logProductAction('add_start', senderId, null);

        await this.bot.sendMessage(chatId,
            `➕ *TAMBAH PRODUK DIGITAL BARU*\n\n` +
            `📝 *Step 1/6:* Masukkan nama produk\n\n` +
            `💡 *Panduan:*\n` +
            `• Nama harus jelas dan deskriptif\n` +
            `• Maksimal 200 karakter\n` +
            `• Hanya gunakan huruf, angka, dan simbol dasar\n\n` +
            `📌 *Contoh:*\n` +
            `• Netflix Premium 1 Bulan\n` +
            `• Spotify Family Plan 3 Bulan\n` +
            `• E-Book Premium JavaScript\n\n` +
            `⚠️ Ketik /cancel untuk membatalkan.`,
            { parse_mode: 'Markdown' }
        );
    }

    async handleProductAddStep(msg, state) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const text = msg.text ? msg.text.trim() : '';

        if (text === '/cancel') {
            this.productAddStates.delete(userId);
            logger.logProductAction('add_cancelled', userId, null);
            return this.bot.sendMessage(chatId, '❌ Proses tambah produk dibatalkan.');
        }

        try {
            switch (state.step) {
                case 'name':
                    // Validate product name
                    if (!validation.isValidProductName(text)) {
                        return this.bot.sendMessage(chatId,
                            `❌ *Nama produk tidak valid!*\n\n` +
                            `Nama harus:\n` +
                            `• 1-200 karakter\n` +
                            `• Hanya huruf, angka, spasi, dan simbol dasar\n\n` +
                            `Silakan coba lagi:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    state.data.name = validation.sanitizeString(text, 200);
                    state.step = 'description';
                    
                    await this.bot.sendMessage(chatId,
                        `✅ Nama produk: *${state.data.name}*\n\n` +
                        `📝 *Step 2/6:* Masukkan deskripsi produk\n\n` +
                        `💡 *Panduan:*\n` +
                        `• Jelaskan detail produk dengan lengkap\n` +
                        `• Sebutkan fitur-fitur utama\n` +
                        `• Maksimal 5000 karakter\n` +
                        `• Bisa menggunakan baris baru\n\n` +
                        `📌 *Contoh:*\n` +
                        `Akun Netflix Premium untuk 1 bulan\n` +
                        `✅ 4K Ultra HD\n` +
                        `✅ Bisa untuk 4 device\n` +
                        `✅ Download unlimited\n` +
                        `✅ Garansi 30 hari`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'description':
                    if (text.length < 10) {
                        return this.bot.sendMessage(chatId,
                            `❌ Deskripsi terlalu pendek! Minimal 10 karakter.\n\nSilakan coba lagi:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    state.data.description = validation.sanitizeString(text, 5000);
                    state.step = 'price';
                    
                    await this.bot.sendMessage(chatId,
                        `✅ Deskripsi tersimpan\n\n` +
                        `💰 *Step 3/6:* Masukkan harga produk (angka saja)\n\n` +
                        `💡 *Panduan:*\n` +
                        `• Harga minimal: Rp 100\n` +
                        `• Harga maksimal: Rp 1.000.000.000\n` +
                        `• Hanya angka, tanpa titik atau koma\n\n` +
                        `📌 *Contoh:*\n` +
                        `50000 untuk Rp 50.000\n` +
                        `125000 untuk Rp 125.000`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'price':
                    if (!validation.isValidPrice(text)) {
                        return this.bot.sendMessage(chatId,
                            `❌ *Harga tidak valid!*\n\n` +
                            `Harga harus:\n` +
                            `• Berupa angka saja\n` +
                            `• Minimal Rp 100\n` +
                            `• Maksimal Rp 1.000.000.000\n\n` +
                            `Silakan coba lagi:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    state.data.price = parseInt(text);
                    state.step = 'stock';
                    
                    await this.bot.sendMessage(chatId,
                        `✅ Harga: Rp ${state.data.price.toLocaleString('id-ID')}\n\n` +
                        `📦 *Step 4/6:* Masukkan jumlah stock\n\n` +
                        `💡 *Panduan:*\n` +
                        `• Stock minimal: 0\n` +
                        `• Stock maksimal: 999999\n` +
                        `• Gunakan 999999 untuk stock unlimited\n\n` +
                        `📌 *Contoh:*\n` +
                        `10 untuk 10 unit\n` +
                        `999999 untuk unlimited`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'stock':
                    if (!validation.isValidStock(text)) {
                        return this.bot.sendMessage(chatId,
                            `❌ *Stock tidak valid!*\n\n` +
                            `Stock harus:\n` +
                            `• Berupa angka saja\n` +
                            `• Minimal 0\n` +
                            `• Maksimal 999999\n\n` +
                            `Silakan coba lagi:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    state.data.stock = parseInt(text);
                    state.step = 'payment_method';
                    
                    const keyboard = {
                        inline_keyboard: [
                            [{ text: '⚡ QRIS Otomatis', callback_data: 'product_payment_auto' }],
                            [{ text: '📸 Manual (Upload Bukti)', callback_data: 'product_payment_manual' }],
                            [{ text: '🔄 Kedua-duanya', callback_data: 'product_payment_both' }]
                        ]
                    };

                    await this.bot.sendMessage(chatId,
                        `✅ Stock: ${state.data.stock.toLocaleString('id-ID')} unit\n\n` +
                        `💳 *Step 5/6:* Pilih metode pembayaran\n\n` +
                        `💡 *Penjelasan:*\n\n` +
                        `⚡ *QRIS Otomatis:*\n` +
                        `• Pembayaran otomatis via QRIS\n` +
                        `• Produk langsung terkirim\n` +
                        `• User scan QR dan saldo masuk otomatis\n\n` +
                        `📸 *Manual:*\n` +
                        `• User upload bukti transfer\n` +
                        `• Owner approve manual\n` +
                        `• Support QRIS, DANA, OVO, BCA\n\n` +
                        `🔄 *Kedua-duanya:*\n` +
                        `• User bisa pilih metode yang diinginkan\n` +
                        `• Paling fleksibel\n\n` +
                        `Pilih metode pembayaran:`,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: keyboard
                        }
                    );
                    break;

                case 'image':
                    // Handle image upload
                    const imageResult = await storage.handleProductImage(msg);
                    
                    if (!imageResult.success) {
                        return this.bot.sendMessage(chatId,
                            `❌ ${imageResult.error}\n\nSilakan upload gambar lagi atau ketik "skip" untuk lewati:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    if (text.toLowerCase() === 'skip') {
                        state.data.image = null;
                    } else if (imageResult.data) {
                        state.data.image = imageResult.data;
                    }

                    state.step = 'product_data';
                    
                    await this.bot.sendMessage(chatId,
                        `${state.data.image ? '✅ Gambar produk tersimpan' : '⏭️ Gambar dilewati'}\n\n` +
                        `📦 *Step 6/6:* Upload data produk\n\n` +
                        `💡 *Panduan Upload Data:*\n\n` +
                        `📝 *Text/Credential:*\n` +
                        `Ketik langsung (email:password, kode aktivasi, dll)\n` +
                        `Maksimal 50.000 karakter\n\n` +
                        `📄 *File:*\n` +
                        `Upload file (.txt, .pdf, .zip, dll)\n` +
                        `Maksimal 50MB via Telegram\n\n` +
                        `🔗 *Link External:*\n` +
                        `Kirim link Google Drive, Mega, Dropbox, dll\n` +
                        `Untuk file >50MB\n\n` +
                        `📌 *Contoh:*\n` +
                        `• email@example.com:password123\n` +
                        `• https://drive.google.com/file/...\n` +
                        `• Upload file langsung\n\n` +
                        `⚠️ Data ini akan dikirim otomatis ke pembeli!`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'product_data':
                    // Process product data (text, file, or link)
                    const dataResult = await storage.processProductData(msg, text);
                    
                    if (!dataResult.success) {
                        return this.bot.sendMessage(chatId,
                            `❌ ${dataResult.error}\n\nSilakan kirim data produk lagi:`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    state.data.productData = dataResult.data;
                    
                    // Save product to database
                    await this.saveProduct(userId, chatId, state.data);
                    break;

                default:
                    this.productAddStates.delete(userId);
                    return this.bot.sendMessage(chatId, '❌ State tidak valid. Silakan mulai lagi dengan /produk_add');
            }

            // Update state
            this.productAddStates.set(userId, state);

        } catch (error) {
            logger.error('Product add step error', error, { userId, step: state.step });
            this.productAddStates.delete(userId);
            
            await this.bot.sendMessage(chatId,
                `❌ *Terjadi Kesalahan*\n\n` +
                `Gagal memproses input. Silakan coba lagi dengan /produk_add`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    async saveProduct(userId, chatId, productData) {
        try {
            const products = await this.db.loadProducts();
            const productId = `PROD-${Date.now()}`;

            const newProduct = {
                id: productId,
                name: productData.name,
                description: productData.description,
                price: productData.price,
                stock: productData.stock,
                paymentMethod: productData.paymentMethod,
                productData: productData.productData,
                image: productData.image || null,
                createdAt: new Date().toISOString(),
                createdBy: userId.toString()
            };

            // Validate before saving
            const validationResult = validation.validateProductData(newProduct);
            if (!validationResult.valid) {
                logger.error('Product validation failed', null, { errors: validationResult.errors });
                return this.bot.sendMessage(chatId,
                    `❌ *Validasi Gagal*\n\nData produk tidak valid. Silakan coba lagi.`,
                    { parse_mode: 'Markdown' }
                );
            }

            products.push(newProduct);
            
            // Save with enhanced database manager
            const saveResult = await this.enhancedDb.saveProductsWithValidation(products);
            
            if (!saveResult.success) {
                return this.bot.sendMessage(chatId,
                    `❌ *Gagal Menyimpan*\n\n${saveResult.error}`,
                    { parse_mode: 'Markdown' }
                );
            }

            this.productAddStates.delete(userId);

            logger.logProductAction('add_success', userId, productId, { name: productData.name });

            // Send confirmation with image if available
            const message = `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
                `📦 *Nama:* ${newProduct.name}\n` +
                `📝 *Deskripsi:* ${newProduct.description.substring(0, 100)}${newProduct.description.length > 100 ? '...' : ''}\n` +
                `💰 *Harga:* Rp ${newProduct.price.toLocaleString('id-ID')}\n` +
                `📦 *Stock:* ${newProduct.stock.toLocaleString('id-ID')}\n` +
                `💳 *Pembayaran:* ${this.getPaymentMethodText(newProduct.paymentMethod)}\n` +
                `📄 *Data Type:* ${this.getDataTypeText(newProduct.productData.type)}\n` +
                `🆔 *ID:* \`${productId}\`\n\n` +
                `✨ Produk sudah aktif dan bisa dibeli user!\n` +
                `📊 Lihat semua produk: /produk_list`;

            if (newProduct.image && newProduct.image.fileId) {
                await this.bot.sendPhoto(chatId, newProduct.image.fileId, {
                    caption: message,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            logger.error('Failed to save product', error, { userId });
            this.productAddStates.delete(userId);
            
            await this.bot.sendMessage(chatId,
                `❌ *Terjadi Kesalahan*\n\nGagal menyimpan produk. Silakan coba lagi.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    getPaymentMethodText(method) {
        const methods = {
            'auto': '⚡ QRIS Otomatis',
            'manual': '📸 Manual',
            'both': '🔄 Otomatis & Manual'
        };
        return methods[method] || method;
    }

    getDataTypeText(type) {
        const types = {
            'text': '📝 Text',
            'telegram_file': '📄 File Telegram',
            'link': '🔗 Link External'
        };
        return types[type] || type;
    }

    async handlePhotoUpload(msg) {
        const userId = msg.from.id;
        const state = this.productAddStates.get(userId);

        if (!state || state.step !== 'image') {
            return; // Not in image upload step
        }

        await this.handleProductAddStep(msg, state);
    }

    async handleDocumentUpload(msg) {
        const userId = msg.from.id;
        const state = this.productAddStates.get(userId);

        if (!state || state.step !== 'product_data') {
            return; // Not in product data upload step
        }

        await this.handleProductAddStep(msg, state);
    }
}

module.exports = ProductHandler;
