# 📚 PANDUAN LENGKAP PRODUK DIGITAL BOT

## 🎯 Fitur Utama Produk Digital

### ✨ Untuk Pembeli (User)

1. **Browse Produk**
   - Lihat semua produk yang tersedia dengan gambar
   - Filter by kategori dan harga
   - Detail lengkap setiap produk

2. **Pembelian Mudah**
   - Pilih produk yang diinginkan
   - Pilih metode pembayaran (QRIS Otomatis / Manual)
   - Bayar dan langsung terima produk

3. **Pembayaran Fleksibel**
   - **QRIS Otomatis**: Scan QR, bayar, langsung dapat produk
   - **Manual**: Upload bukti transfer (QRIS/DANA/OVO/BCA)

4. **Riwayat Pembelian**
   - Lihat semua produk yang sudah dibeli
   - Download ulang produk kapan saja
   - Status pembelian jelas

### 👑 Untuk Owner

1. **Manajemen Produk**
   - Tambah produk dengan gambar
   - Edit harga dan stock
   - Hapus produk
   - Lihat statistik penjualan

2. **Kontrol Penuh**
   - Approve/reject pembayaran manual
   - Blacklist user bermasalah
   - Monitoring real-time
   - Backup otomatis

3. **Keamanan Tinggi**
   - Anti-debug system
   - Rate limiting
   - Validasi ketat
   - Logging comprehensive

## 📝 Cara Menambah Produk (Owner Only)

### Command: `/produk_add`

**Step 1: Nama Produk**
```
Contoh: Netflix Premium 1 Bulan
```
- Maksimal 200 karakter
- Hanya huruf, angka, dan simbol dasar

**Step 2: Deskripsi**
```
Contoh:
Akun Netflix Premium untuk 1 bulan
✅ 4K Ultra HD
✅ Bisa untuk 4 device
✅ Download unlimited
✅ Garansi 30 hari
```
- Maksimal 5000 karakter
- Bisa multi-line
- Jelaskan fitur lengkap

**Step 3: Harga**
```
Contoh: 50000 (untuk Rp 50.000)
```
- Minimal Rp 100
- Maksimal Rp 1.000.000.000
- Hanya angka

**Step 4: Stock**
```
Contoh: 10 (untuk 10 unit)
Atau: 999999 (untuk unlimited)
```
- Minimal 0
- Maksimal 999999

**Step 5: Metode Pembayaran**
- ⚡ QRIS Otomatis (instant)
- 📸 Manual (perlu approval)
- 🔄 Kedua-duanya (fleksibel)

**Step 6: Gambar Produk (Optional)**
- Upload gambar produk
- Maksimal 10MB
- Format: JPG, PNG
- Atau ketik "skip" untuk lewati

**Step 7: Data Produk**
Pilih salah satu:

1. **Text/Credential**
   ```
   email@example.com:password123
   ```
   - Langsung ketik
   - Maksimal 50.000 karakter

2. **File Telegram**
   - Upload file (.txt, .pdf, .zip, dll)
   - Maksimal 50MB

3. **Link External**
   ```
   https://drive.google.com/file/d/xxxxx
   ```
   - Google Drive, Mega, Dropbox, dll
   - Untuk file >50MB

## 🛒 Cara Beli Produk (User)

### 1. Browse Produk
```
/start → 🛍️ Produk Digital
```
- Lihat semua produk tersedia
- Klik untuk detail lengkap

### 2. Pilih Produk
- Klik tombol "💰 Beli Sekarang"
- Konfirmasi pembelian

### 3. Bayar
#### Jika QRIS Otomatis:
1. Scan QR Code yang muncul
2. Bayar melalui app (DANA/OVO/GoPay/ShopeePay)
3. Produk otomatis terkirim

#### Jika Manual:
1. Transfer ke rekening yang ditampilkan
2. Upload bukti transfer
3. Tunggu approval owner (max 1 jam)
4. Produk terkirim setelah approved

### 4. Terima Produk
Produk akan dikirim otomatis ke chat dengan format:
- Gambar produk (jika ada)
- Data produk (text/file/link)
- Instruksi penggunaan

## 🔒 Fitur Keamanan

### Anti-Debug
- Validasi ketat setiap input
- Prevent SQL injection
- Sanitize semua data
- Error handling comprehensive

### Rate Limiting
- Maksimal 10 command per menit
- Auto-block spam
- Cooldown system

### Blacklist System
- Owner bisa blacklist user
- Block permanent
- Notifikasi ke user

### Data Integrity
- Backup otomatis
- Schema validation
- Transaction rollback
- Checksum verification

## 📊 Command Owner

```bash
/produk_add        # Tambah produk baru
/produk_list       # Lihat semua produk
/delproduk [ID]    # Hapus produk
/history_produk    # Riwayat penjualan

/del [USER_ID]     # Hapus & blacklist user
/info [USER_ID]    # Info detail user
/reff [ID] [AMOUNT] # Add saldo user
/bc [TEXT]         # Broadcast ke semua user
```

## 💳 Metode Pembayaran Manual

### QRIS
- Scan QR yang ditampilkan
- Support semua e-wallet

### DANA
```
Nomor: 083834186945
Nama: Mohxxxx
```

### OVO
```
Nomor: 083122028438
Nama: jeeyxxx
```

### BCA (jika enabled)
```
Rekening: 1234567890
Nama: John Doe
```

## 📱 Notifikasi Testimoni

Setiap pembelian sukses akan di-post ke channel testimoni:
- Nama produk
- Harga
- Username pembeli (di-mask)
- Timestamp

## ❓ FAQ

**Q: Berapa lama proses pembayaran manual?**
A: Maksimal 1 jam setelah upload bukti transfer

**Q: Bisa refund?**
A: Saldo di bot tidak bisa di-refund (sesuai T&C)

**Q: Data produk aman?**
A: Ya, disimpan dengan enkripsi dan backup otomatis

**Q: Stock habis kapan restock?**
A: Hubungi owner via @Jeeyhosting

**Q: Bisa jual produk saya sendiri?**
A: Tidak, hanya owner yang bisa menambah produk

## 🆘 Troubleshooting

**Pembayaran tidak terdeteksi:**
1. Tunggu 5 menit
2. Cek status di "📋 Pesanan Aktif"
3. Jika masih bermasalah, hubungi @Jeeyhosting

**Produk tidak terkirim:**
1. Cek "📜 Riwayat Order"
2. Screenshot dan kirim ke owner
3. Akan di-solve maksimal 1 jam

**Error saat beli:**
1. Pastikan saldo cukup
2. Coba restart bot (/start)
3. Jika masih error, lapor owner

## 📞 Support

Owner: @Jeeyhosting
Channel: @MarketplaceclCretatorID

---

*Bot ini dilengkapi dengan sistem anti-error, anti-debug, dan keamanan tingkat tinggi untuk memastikan pengalaman terbaik.*
