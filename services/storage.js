const logger = require('./logger');
const path = require('path');

class StorageService {
    constructor() {
        this.bot = null;
    }

    setBot(bot) {
        this.bot = bot;
    }

    async handleProductImage(msg) {
        try {
            let imageData = null;

            // Handle photo
            if (msg.photo && msg.photo.length > 0) {
                const photo = msg.photo[msg.photo.length - 1]; // Get highest resolution
                const fileSize = photo.file_size || 0;
                
                if (fileSize > 10 * 1024 * 1024) { // Max 10MB
                    return {
                        success: false,
                        error: 'Ukuran gambar terlalu besar. Maksimal 10MB.'
                    };
                }

                imageData = {
                    fileId: photo.file_id,
                    fileSize: fileSize,
                    width: photo.width,
                    height: photo.height
                };

                logger.info('Product image uploaded', { 
                    userId: msg.from.id, 
                    fileSize 
                });
            }

            return {
                success: true,
                data: imageData
            };

        } catch (error) {
            logger.error('Failed to handle product image', error);
            return {
                success: false,
                error: 'Gagal memproses gambar. Silakan coba lagi.'
            };
        }
    }

    async handleProductFile(msg) {
        try {
            let fileData = null;

            // Handle document/file
            if (msg.document) {
                const doc = msg.document;
                const fileSize = doc.file_size || 0;
                
                // Telegram file limit is 50MB for bots
                if (fileSize > 50 * 1024 * 1024) {
                    return {
                        success: false,
                        error: 'Ukuran file terlalu besar. Maksimal 50MB untuk Telegram.\nGunakan link Google Drive/Mega untuk file lebih besar.'
                    };
                }

                fileData = {
                    type: 'telegram_file',
                    fileId: doc.file_id,
                    fileName: doc.file_name || 'product_file',
                    fileSize: fileSize,
                    mimeType: doc.mime_type
                };

                logger.info('Product file uploaded', { 
                    userId: msg.from.id, 
                    fileName: fileData.fileName,
                    fileSize 
                });
            }

            return {
                success: true,
                data: fileData
            };

        } catch (error) {
            logger.error('Failed to handle product file', error);
            return {
                success: false,
                error: 'Gagal memproses file. Silakan coba lagi.'
            };
        }
    }

    validateExternalLink(link) {
        try {
            // Validate URL format
            const url = new URL(link);
            
            // Allow common file sharing services
            const allowedDomains = [
                'drive.google.com',
                'docs.google.com',
                'mega.nz',
                'mega.io',
                'dropbox.com',
                'mediafire.com',
                'zippyshare.com',
                'wetransfer.com',
                'sendspace.com',
                'catbox.moe',
                'files.catbox.moe',
                'anonfiles.com',
                'gofile.io'
            ];

            const isAllowed = allowedDomains.some(domain => 
                url.hostname.includes(domain)
            );

            if (!isAllowed) {
                return {
                    valid: false,
                    error: 'Link harus dari Google Drive, Mega, Dropbox, Catbox, atau file sharing service yang di-support.'
                };
            }

            return { valid: true, url: link };

        } catch (error) {
            return {
                valid: false,
                error: 'Format link tidak valid. Pastikan menggunakan URL lengkap (https://...).'
            };
        }
    }

    async processProductData(msg, msgText) {
        try {
            // Priority: File > Photo > Text/Link

            // Check if it's a document/file
            if (msg.document) {
                const fileResult = await this.handleProductFile(msg);
                if (fileResult.success && fileResult.data) {
                    return {
                        success: true,
                        data: fileResult.data
                    };
                }
            }

            // Check if it's text content
            if (msgText) {
                // Check if it's a link
                if (msgText.startsWith('http://') || msgText.startsWith('https://')) {
                    const linkValidation = this.validateExternalLink(msgText);
                    if (!linkValidation.valid) {
                        return {
                            success: false,
                            error: linkValidation.error
                        };
                    }

                    return {
                        success: true,
                        data: {
                            type: 'link',
                            content: msgText
                        }
                    };
                }

                // It's plain text
                if (msgText.length > 50000) {
                    return {
                        success: false,
                        error: 'Text terlalu panjang. Maksimal 50,000 karakter.\nGunakan file atau link untuk data yang lebih besar.'
                    };
                }

                return {
                    success: true,
                    data: {
                        type: 'text',
                        content: msgText
                    }
                };
            }

            return {
                success: false,
                error: 'Tidak ada data produk yang terdeteksi. Kirim text, file, atau link.'
            };

        } catch (error) {
            logger.error('Failed to process product data', error);
            return {
                success: false,
                error: 'Gagal memproses data produk. Silakan coba lagi.'
            };
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }
}

module.exports = new StorageService();
