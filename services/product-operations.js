const logger = require('./logger');
const security = require('./security');
const validation = require('./validation');
const notifications = require('./notifications');
const payments = require('./payments');

class ProductOperations {
    constructor(bot, config, db, enhancedDb) {
        this.bot = bot;
        this.config = config;
        this.db = db;
        this.enhancedDb = enhancedDb;
    }

    async showProdukDigital(chatId, messageId, userId, page = 0) {
        try {
            // Security check
            const accessCheck = await security.validateAccess(userId, 'view_products');
            if (!accessCheck.allowed) {
                return this.bot.editMessageText(accessCheck.message, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }

            const products = await this.db.loadProducts();
            const activeProducts = products.filter(p => p.stock > 0);

            const itemsPerPage = 5;
            const totalPages = Math.ceil(activeProducts.length / itemsPerPage);
            const currentPage = Math.max(0, Math.min(page, totalPages - 1));
            const startIdx = currentPage * itemsPerPage;
            const endIdx = startIdx + itemsPerPage;
            const displayProducts = activeProducts.slice(startIdx, endIdx);

            const keyboard = { inline_keyboard: [] };

            let text = `🛍️ *PRODUK DIGITAL TERSEDIA*\n\n`;

            if (activeProducts.length === 0) {
                text += `📦 *Belum ada produk tersedia*\n\n`;
                text += `Silakan cek lagi nanti atau hubungi @Jeeyhosting\n\n`;
                text += `💡 Produk baru akan segera ditambahkan!`;
            } else {
                text += `📊 Total Produk: ${activeProducts.length}\n`;
                text += `📄 Halaman ${currentPage + 1}/${totalPages}\n\n`;
                text += `━━━━━━━━━━━━━━━━━━\n\n`;

                displayProducts.forEach((product, index) => {
                    const num = startIdx + index + 1;
                    const imageIcon = product.image ? '🖼️ ' : '';
                    
                    text += `${num}. ${imageIcon}*${product.name}*\n`;
                    text += `   💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n`;
                    text += `   📦 Stock: ${product.stock >= 999999 ? '∞ Unlimited' : product.stock}\n`;
                    text += `   📝 ${product.description.substring(0, 80)}${product.description.length > 80 ? '...' : ''}\n`;
                    
                    // Add buy button for each product
                    keyboard.inline_keyboard.push([
                        { 
                            text: `💰 Beli #${num}: ${product.name.substring(0, 25)}`, 
                            callback_data: `buy_product_${product.id}` 
                        }
                    ]);
                    
                    text += `\n`;
                });

                // Pagination buttons
                if (totalPages > 1) {
                    const paginationRow = [];
                    if (currentPage > 0) {
                        paginationRow.push({ 
                            text: '⬅️ Sebelumnya', 
                            callback_data: `produk_page_${currentPage - 1}` 
                        });
                    }
                    if (currentPage < totalPages - 1) {
                        paginationRow.push({ 
                            text: 'Selanjutnya ➡️', 
                            callback_data: `produk_page_${currentPage + 1}` 
                        });
                    }
                    if (paginationRow.length > 0) {
                        keyboard.inline_keyboard.push(paginationRow);
                    }
                }
            }

            keyboard.inline_keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'back_main' }]);

            await this.bot.editMessageCaption(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            }).catch(async () => {
                // If caption edit fails, try to send as new message
                await this.bot.sendPhoto(chatId, this.config.BOT_LOGO || 'https://files.catbox.moe/d49amr.png', {
                    caption: text,
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            });

            logger.logProductAction('view_list', userId, null, { page: currentPage });

        } catch (error) {
            logger.error('Show products error', error, { userId });
            
            await this.bot.editMessageText(
                '❌ Gagal memuat produk. Silakan coba lagi.',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'back_main' }]]
                    }
                }
            );
        }
    }

    async confirmProductPurchase(chatId, messageId, data, userId) {
        try {
            const productId = data.replace('buy_product_', '');
            
            const products = await this.db.loadProducts();
            const product = products.find(p => p.id === productId);

            if (!product) {
                return this.bot.editMessageText(
                    '❌ Produk tidak ditemukan atau sudah dihapus.',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: {
                            inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]]
                        }
                    }
                );
            }

            if (product.stock <= 0) {
                return this.bot.editMessageText(
                    '❌ *Stock Habis*\n\nProduk ini sudah habis. Silakan pilih produk lain atau hubungi owner.',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'produk_digital' }]]
                        }
                    }
                );
            }

            const user = await this.getUser(userId);
            const userSaldo = user ? user.saldo : 0;

            const keyboard = { inline_keyboard: [] };

            let confirmText = `📦 *KONFIRMASI PEMBELIAN*\n\n`;
            confirmText += `🛍️ *Produk:* ${product.name}\n`;
            confirmText += `📝 *Deskripsi:*\n${product.description}\n\n`;
            confirmText += `💰 *Harga:* Rp ${product.price.toLocaleString('id-ID')}\n`;
            confirmText += `📦 *Stock:* ${product.stock >= 999999 ? '∞ Unlimited' : product.stock}\n`;
            confirmText += `💳 *Metode:* ${this.getPaymentMethodText(product.paymentMethod)}\n\n`;
            confirmText += `━━━━━━━━━━━━━━━━━━\n\n`;
            confirmText += `👤 *Info Anda:*\n`;
            confirmText += `💰 Saldo: Rp ${userSaldo.toLocaleString('id-ID')}\n\n`;

            // Payment method buttons
            if (product.paymentMethod === 'auto' || product.paymentMethod === 'both') {
                if (userSaldo >= product.price) {
                    keyboard.inline_keyboard.push([{ 
                        text: '⚡ Bayar dengan Saldo', 
                        callback_data: `confirm_buy_product_${productId}_saldo` 
                    }]);
                }
                keyboard.inline_keyboard.push([{ 
                    text: '💳 Bayar dengan QRIS', 
                    callback_data: `confirm_buy_product_${productId}_qris` 
                }]);
            }
            
            if (product.paymentMethod === 'manual' || product.paymentMethod === 'both') {
                keyboard.inline_keyboard.push([{ 
                    text: '📸 Bayar Manual (Upload Bukti)', 
                    callback_data: `confirm_buy_product_${productId}_manual` 
                }]);
            }

            keyboard.inline_keyboard.push([{ text: '❌ Batal', callback_data: 'produk_digital' }]);

            // Send product image if available
            if (product.image && product.image.fileId) {
                await this.bot.editMessageMedia({
                    type: 'photo',
                    media: product.image.fileId,
                    caption: confirmText,
                    parse_mode: 'Markdown'
                }, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard
                }).catch(async () => {
                    await this.bot.editMessageText(confirmText, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                });
            } else {
                await this.bot.editMessageText(confirmText, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }

            logger.logProductAction('view_detail', userId, productId);

        } catch (error) {
            logger.error('Confirm product purchase error', error, { userId });
            
            await this.bot.answerCallbackQuery(data, {
                text: '❌ Terjadi kesalahan. Silakan coba lagi.',
                show_alert: true
            });
        }
    }

    async processProductPurchase(chatId, messageId, data, userId, query) {
        try {
            const parts = data.replace('confirm_buy_product_', '').split('_');
            const productId = parts[0];
            const paymentMethod = parts[1]; // saldo, qris, or manual

            const products = await this.db.loadProducts();
            const productIndex = products.findIndex(p => p.id === productId);

            if (productIndex === -1) {
                return this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Produk tidak ditemukan',
                    show_alert: true
                });
            }

            const product = products[productIndex];

            if (product.stock <= 0) {
                return this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Stock habis',
                    show_alert: true
                });
            }

            const user = await this.getUser(userId);
            const orderId = `ORDER-${Date.now()}`;
            const timeInfo = this.getIndonesianTime();

            // Handle different payment methods
            if (paymentMethod === 'saldo') {
                // Payment with balance
                if (!user || user.saldo < product.price) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: '❌ Saldo tidak cukup',
                        show_alert: true
                    });
                }

                // Deduct balance
                user.saldo -= product.price;
                
                // Decrease stock
                products[productIndex].stock -= 1;

                // Save changes
                const users = await this.db.loadUsers();
                const userIndex = users.findIndex(u => u.id === userId.toString());
                if (userIndex !== -1) {
                    users[userIndex] = user;
                    await this.db.saveUsers(users);
                }
                
                await this.enhancedDb.saveProductsWithValidation(products);

                // Create order record
                const productOrders = await this.db.loadProductOrders();
                productOrders.push({
                    orderId,
                    userId: userId.toString(),
                    username: query.from.username || 'Unknown',
                    fullName: query.from.first_name + (query.from.last_name ? ` ${query.from.last_name}` : ''),
                    productId: product.id,
                    productName: product.name,
                    price: product.price,
                    paymentMethod: 'saldo',
                    status: 'completed',
                    createdAt: timeInfo.timestamp,
                    completedAt: timeInfo.timestamp,
                    timeInfo
                });
                
                await this.enhancedDb.saveProductOrdersWithValidation(productOrders);

                // Send product to user
                await notifications.sendProductDelivery(userId, product, { orderId });

                // Send testimony notification
                await notifications.sendTestimonyNotification({
                    productName: product.name,
                    price: product.price,
                    username: query.from.username,
                    userId: userId,
                    fullName: query.from.first_name,
                    orderId,
                    productImage: product.image
                });

                logger.logOrderAction('purchase_success_saldo', userId, orderId, { 
                    productId: product.id,
                    price: product.price 
                });

                await this.bot.editMessageText(
                    `✅ *PEMBELIAN BERHASIL!*\n\n` +
                    `📦 Produk: ${product.name}\n` +
                    `💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n` +
                    `🆔 Order ID: \`${orderId}\`\n\n` +
                    `✨ Produk telah dikirim ke chat ini!\n` +
                    `💰 Sisa saldo: Rp ${user.saldo.toLocaleString('id-ID')}`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'back_main' }]]
                        }
                    }
                );

            } else if (paymentMethod === 'qris') {
                // QRIS payment
                const qrisResult = await payments.createQRISDeposit(product.price, userId);

                if (!qrisResult.success) {
                    return this.bot.answerCallbackQuery(query.id, {
                        text: qrisResult.error || '❌ Gagal membuat pembayaran',
                        show_alert: true
                    });
                }

                // Implementation similar to deposit flow with QRIS
                // This will be handled by the existing deposit monitoring system
                // but linked to product purchase

                logger.logOrderAction('purchase_qris_initiated', userId, orderId, {
                    productId: product.id,
                    trxId: qrisResult.data.id
                });

            } else if (paymentMethod === 'manual') {
                // Manual payment - create pending order
                const productOrders = await this.db.loadProductOrders();
                productOrders.push({
                    orderId,
                    userId: userId.toString(),
                    username: query.from.username || 'Unknown',
                    fullName: query.from.first_name + (query.from.last_name ? ` ${query.from.last_name}` : ''),
                    productId: product.id,
                    productName: product.name,
                    price: product.price,
                    paymentMethod: 'manual',
                    status: 'pending',
                    createdAt: timeInfo.timestamp,
                    timeInfo
                });
                
                await this.enhancedDb.saveProductOrdersWithValidation(productOrders);

                // Show manual payment options
                const manualOptions = await payments.getManualPaymentOptions();
                
                let paymentText = `📸 *PEMBAYARAN MANUAL*\n\n`;
                paymentText += `📦 Produk: ${product.name}\n`;
                paymentText += `💰 Total: Rp ${product.price.toLocaleString('id-ID')}\n`;
                paymentText += `🆔 Order ID: \`${orderId}\`\n\n`;
                paymentText += `💳 *Pilih Metode Pembayaran:*\n\n`;

                manualOptions.forEach(opt => {
                    paymentText += `${opt.icon} *${opt.type}*\n`;
                    if (opt.number) {
                        paymentText += `Nomor: \`${opt.number}\`\n`;
                    }
                    if (opt.name) {
                        paymentText += `Nama: ${opt.name}\n`;
                    }
                    paymentText += `\n`;
                });

                paymentText += `━━━━━━━━━━━━━━━━━━\n\n`;
                paymentText += `📋 *Langkah-langkah:*\n`;
                paymentText += `1️⃣ Transfer ke salah satu rekening di atas\n`;
                paymentText += `2️⃣ Screenshot bukti transfer\n`;
                paymentText += `3️⃣ Upload bukti transfer\n`;
                paymentText += `4️⃣ Tunggu approval (max 1 jam)\n\n`;
                paymentText += `⚠️ *PENTING:* Simpan Order ID untuk tracking!`;

                await this.bot.editMessageText(paymentText, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📸 Upload Bukti Transfer', callback_data: `manual_pay_${orderId}` }],
                            [{ text: '❌ Batal', callback_data: 'produk_digital' }]
                        ]
                    }
                });

                logger.logOrderAction('purchase_manual_initiated', userId, orderId, {
                    productId: product.id
                });
            }

        } catch (error) {
            logger.error('Process product purchase error', error, { userId });
            
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Terjadi kesalahan. Silakan coba lagi.',
                show_alert: true
            });
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

    async getUser(userId) {
        const users = await this.db.loadUsers();
        return users.find(u => u.id === userId.toString());
    }

    getIndonesianTime() {
        const now = new Date();
        const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        
        const date = jakartaTime.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
        
        const time = jakartaTime.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        
        return { date, time, timestamp: jakartaTime.toISOString() };
    }
}

module.exports = ProductOperations;
