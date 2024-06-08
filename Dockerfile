# Gunakan image resmi Node.js sebagai image dasar
FROM node:14

# Atur direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin file package.json dan package-lock.json ke direktori kerja
COPY package*.json ./

# Install dependencies aplikasi
RUN npm install

# Salin semua file dari direktori aplikasi lokal ke dalam direktori kerja di dalam container
COPY . .

# Ekspos port yang akan digunakan oleh aplikasi
EXPOSE 3000

# Tentukan perintah untuk menjalankan aplikasi
CMD ["npm", "run", "start"]
