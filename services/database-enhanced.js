const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const validation = require('./validation');

class EnhancedDatabaseManager {
    constructor(baseDb) {
        this.baseDb = baseDb;
        this.backupDir = path.join('data', 'backup');
        this.maxBackups = 10;
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            logger.info('Enhanced database initialized');
        } catch (error) {
            logger.error('Failed to initialize enhanced database', error);
        }
    }

    async createBackup(fileName) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(this.backupDir, `${fileName}_${timestamp}.json`);
            
            const data = await fs.readFile(fileName, 'utf8');
            await fs.writeFile(backupPath, data);
            
            logger.info('Backup created', { file: fileName, backup: backupPath });
            
            // Cleanup old backups
            await this.cleanupOldBackups(fileName);
            
            return { success: true, backupPath };
        } catch (error) {
            logger.error('Backup creation failed', error, { file: fileName });
            return { success: false, error: error.message };
        }
    }

    async cleanupOldBackups(fileName) {
        try {
            const files = await fs.readdir(this.backupDir);
            const prefix = path.basename(fileName, '.json');
            const backupFiles = files
                .filter(f => f.startsWith(prefix))
                .sort()
                .reverse();
            
            // Keep only maxBackups newest backups
            if (backupFiles.length > this.maxBackups) {
                const toDelete = backupFiles.slice(this.maxBackups);
                for (const file of toDelete) {
                    await fs.unlink(path.join(this.backupDir, file));
                }
                logger.info('Old backups cleaned', { deleted: toDelete.length });
            }
        } catch (error) {
            logger.error('Backup cleanup failed', error);
        }
    }

    async saveProductsWithValidation(products) {
        try {
            // Validate all products
            for (const product of products) {
                const validationResult = validation.validateProductData(product);
                if (!validationResult.valid) {
                    logger.error('Product validation failed', null, {
                        productId: product.id,
                        errors: validationResult.errors
                    });
                    return {
                        success: false,
                        error: 'Data produk tidak valid. Silakan periksa kembali.'
                    };
                }
            }

            // Create backup before save
            await this.createBackup(this.baseDb.productsFile);
            
            // Save products
            await this.baseDb.saveProducts(products);
            
            logger.info('Products saved with validation', { count: products.length });
            
            return { success: true };

        } catch (error) {
            logger.error('Failed to save products', error);
            return {
                success: false,
                error: 'Gagal menyimpan data produk. Silakan coba lagi.'
            };
        }
    }

    async saveProductOrdersWithValidation(orders) {
        try {
            // Validate all orders
            for (const order of orders) {
                const validationResult = validation.validateProductOrderData(order);
                if (!validationResult.valid) {
                    logger.error('Product order validation failed', null, {
                        orderId: order.orderId,
                        errors: validationResult.errors
                    });
                    return {
                        success: false,
                        error: 'Data order tidak valid.'
                    };
                }
            }

            // Create backup before save
            await this.createBackup(this.baseDb.productOrdersFile);
            
            // Save orders
            await this.baseDb.saveProductOrders(orders);
            
            logger.info('Product orders saved with validation', { count: orders.length });
            
            return { success: true };

        } catch (error) {
            logger.error('Failed to save product orders', error);
            return {
                success: false,
                error: 'Gagal menyimpan data order. Silakan coba lagi.'
            };
        }
    }

    async transactionWrapper(operation, rollbackData) {
        try {
            // Execute operation
            const result = await operation();
            return { success: true, result };

        } catch (error) {
            logger.error('Transaction failed, rolling back', error);
            
            // Attempt rollback if provided
            if (rollbackData) {
                try {
                    await rollbackData.rollback();
                    logger.info('Rollback successful');
                } catch (rollbackError) {
                    logger.error('Rollback failed', rollbackError);
                }
            }
            
            return {
                success: false,
                error: 'Operasi gagal. Data telah dikembalikan ke kondisi semula.'
            };
        }
    }

    async verifyDataIntegrity() {
        try {
            const products = await this.baseDb.loadProducts();
            const orders = await this.baseDb.loadProductOrders();
            
            let issues = [];

            // Check products integrity
            for (const product of products) {
                const validationResult = validation.validateProductData(product);
                if (!validationResult.valid) {
                    issues.push({
                        type: 'product',
                        id: product.id,
                        errors: validationResult.errors
                    });
                }
            }

            // Check orders integrity
            for (const order of orders) {
                const validationResult = validation.validateProductOrderData(order);
                if (!validationResult.valid) {
                    issues.push({
                        type: 'order',
                        id: order.orderId,
                        errors: validationResult.errors
                    });
                }

                // Check if product still exists
                const productExists = products.some(p => p.id === order.productId);
                if (!productExists) {
                    issues.push({
                        type: 'orphan_order',
                        id: order.orderId,
                        productId: order.productId
                    });
                }
            }

            if (issues.length > 0) {
                logger.warn('Data integrity issues found', { issues });
            }

            return {
                valid: issues.length === 0,
                issues
            };

        } catch (error) {
            logger.error('Data integrity check failed', error);
            return {
                valid: false,
                error: error.message
            };
        }
    }
}

module.exports = EnhancedDatabaseManager;
