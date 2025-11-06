const logger = require('./logger');
const security = require('./security');

class NotificationService {
    constructor() {
        this.bot = null;
        this.config = null;
    }

    setBot(bot, config) {
        this.bot = bot;
        this.config = config;
    }

    async sendTestimonyNotification(orderData) {
        if (!this.bot || !this.config || !this.config.TESTIMONI_CHANNEL) {
            logger.error('Testimony notification not configured');
            return;
        }

        try {
            const { 
                productName, 
                price, 
                username, 
                userId,
                fullName,
                orderId,
                productImage
            } = orderData;

            const sanitizedUser = security.sanitizeUsername(username || fullName);
            const sanitizedId = security.sanitizeUserId(userId);
            
            const timeInfo = this.getIndonesianTime();
            
            const caption = `✨ *TESTIMONI PEMBELIAN PRODUK*\n\n` +
                `📦 *Produk:* ${productName}\n` +
                `💰 *Harga:* Rp ${price.toLocaleString('id-ID')}\n` +
                `👤 *Pembeli:* ${sanitizedUser}\n` +
                `🆔 *ID:* ${sanitizedId}\n` +
                `📅 *Tanggal:* ${timeInfo.date}\n` +
                `🕐 *Jam:* ${timeInfo.time}\n` +
                `📝 *Order ID:* \`${orderId}\`\n\n` +
                `✅ Terima kasih atas kepercayaannya!\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `🤖 Multi-Provider SMS Bot\n` +
                `👨‍💻 @Jeeyhosting`;

            // Kirim ke channel testimoni
            if (productImage && productImage.fileId) {
                await this.bot.sendPhoto(this.config.TESTIMONI_CHANNEL, productImage.fileId, {
                    caption: caption,
                    parse_mode: 'Markdown'
                });
            } else {
                await this.bot.sendMessage(this.config.TESTIMONI_CHANNEL, caption, {
                    parse_mode: 'Markdown'
                });
            }

            logger.logOrderAction('testimony_sent', userId, orderId, { 
                channel: this.config.TESTIMONI_CHANNEL 
            });

        } catch (error) {
            logger.error('Failed to send testimony notification', error, { 
                orderId: orderData.orderId 
            });
        }
    }

    async sendProductDelivery(userId, productData, orderData) {
        if (!this.bot) {
            logger.error('Bot not configured for product delivery');
            return;
        }

        try {
            const { name, productData: delivery, image } = productData;
            const { orderId } = orderData;

            let message = `✅ *PRODUK TELAH DIBELI*\n\n` +
                `📦 *Produk:* ${name}\n` +
                `💰 *Harga:* Rp ${productData.price.toLocaleString('id-ID')}\n` +
                `🆔 *Order ID:* \`${orderId}\`\n\n` +
                `📥 *DATA PRODUK:*\n\n`;

            // Send product image first if available
            if (image && image.fileId) {
                await this.bot.sendPhoto(userId, image.fileId, {
                    caption: `📦 ${name}\n\n✅ Produk siap digunakan!`,
                    parse_mode: 'Markdown'
                });
            }

            // Send product data based on type
            if (delivery.type === 'text') {
                message += delivery.content;
                await this.bot.sendMessage(userId, message, { 
                    parse_mode: 'Markdown' 
                });
            } else if (delivery.type === 'telegram_file' && delivery.fileId) {
                await this.bot.sendDocument(userId, delivery.fileId, {
                    caption: message,
                    parse_mode: 'Markdown'
                });
            } else if (delivery.type === 'link') {
                message += `🔗 Link: ${delivery.content}\n\n`;
                message += `Silakan klik link di atas untuk mengakses produk Anda.`;
                await this.bot.sendMessage(userId, message, { 
                    parse_mode: 'Markdown' 
                });
            }

            logger.logOrderAction('product_delivered', userId, orderId);

        } catch (error) {
            logger.error('Failed to deliver product', error, { 
                userId, 
                orderId: orderData.orderId 
            });
        }
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

module.exports = new NotificationService();
