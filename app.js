const express = require('express');
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where } = require('firebase/firestore');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();
const FormData = require('form-data');
const fs = require('fs');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const storage = new Storage({
  keyFilename: './bucketAccountKey.json',
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const bucket = storage.bucket('books-litswap');

const app = express();
app.use(express.json());

const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });

// Middleware otentikasi
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'Tidak diizinkan' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).send({ error: 'Tidak diizinkan' });
  }
};

// Validator untuk registrasi
const validateRegister = [
  body('email').isEmail().withMessage('Format email tidak valid'),
  body('password').isLength({ min: 6 }).withMessage('Password harus memiliki panjang minimal 6 karakter'),
  body('displayName').notEmpty().withMessage('Nama tampilan harus diisi'),
  body('umur').isInt({ min: 0 }).withMessage('Umur harus berupa bilangan bulat positif'),
  body('pekerjaan').notEmpty().withMessage('Pekerjaan harus diisi'),
  body('namaInstansi').notEmpty().withMessage('Nama instansi harus diisi'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

// Validator untuk login
const validateLogin = [
  body('email').isEmail().withMessage('Format email tidak valid'),
  body('password').notEmpty().withMessage('Password harus diisi'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

// Validator untuk menambahkan buku
const validateAddBook = [
  body('isbn').notEmpty().withMessage('ISBN harus diisi'),
  body('price').optional().isNumeric().withMessage('Harga harus berupa angka'),
  body('genre').optional().notEmpty().withMessage('Genre tidak boleh kosong'),
  body('conditionDescription').optional().notEmpty().withMessage('Deskripsi kondisi tidak boleh kosong'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

// Endpoint untuk root
app.get('/', (req, res) => {
  res.send('Halo, Litswap');
});

// Route untuk registrasi pengguna
app.post('/register', validateRegister, async (req, res) => {
  const { email, password, displayName, umur, pekerjaan, namaInstansi } = req.body;

  try {
    const user = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName,
    });

    const userData = {
      uid: user.uid,
      displayName: displayName,
      umur: umur,
      pekerjaan: pekerjaan,
      namaInstansi: namaInstansi
    };

    await addDoc(collection(db, 'users'), userData);

    res.status(201).send({ message: 'Pengguna berhasil dibuat', user });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

// Route untuk login pengguna
app.post('/login', validateLogin, async (req, res) => {
  const { email, password } = req.body;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    res.send({ token });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

// Route untuk menambahkan buku
app.post('/books', authenticate, upload.single('bookImage'), validateAddBook, async (req, res) => {
  const { isbn, price, genre, conditionDescription } = req.body;
  const userId = req.user.uid;
  let namafile = null; // Deklarasikan di sini untuk akses di luar blok if

  try {
    const userBooksRef = collection(db, 'books');
    const userBooksQuerySnapshot = await getDocs(query(userBooksRef, where('userId', '==', userId), where('isbn', '==', isbn)));

    if (!userBooksQuerySnapshot.empty) {
      return res.status(400).send({ error: 'Anda sudah memiliki buku ini dalam koleksi Anda' });
    }

    const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const bookData = response.data.items[0].volumeInfo;

    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', userId)));
    let userDisplayName = 'Nama Tidak Diketahui';

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userDisplayName = doc.data().displayName;
      }
    });

    let imageUrl = null;
    if (req.file) {
      namafile = `${Date.now()}_${req.file.originalname}`;
      const fileName = `bookImages/raw/${namafile}`;
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream();

      blobStream.on('error', (err) => {
        console.error('Error mengunggah gambar ke Google Cloud Storage:', err);
        return res.status(500).send({ error: 'Gagal mengunggah gambar ke Google Cloud Storage', details: err.message });
      });

      blobStream.on('finish', async () => {
        imageUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
        console.log('URL gambar:', imageUrl);

        try {
          console.log('Payload yang dikirim:', { filename: namafile });
          const formData = new FormData();
          formData.append('filename', namafile); // Menggunakan namafile di sini

          const headers = {
            ...formData.getHeaders(),
          };

          const flaskResponse = await axios.post('https://bcs-litswap-api-au43kti5qq-et.a.run.app/process', formData, { headers });

          const processedImageUrl = flaskResponse.data;

          const newBook = {
            userId: userId,
            ownerName: userDisplayName,
            isbn: isbn,
            title: bookData.title,
            author: bookData.authors ? bookData.authors[0] : 'Penulis Tidak Diketahui',
            description: bookData.description || 'Deskripsi Tidak Tersedia',
            year: bookData.publishedDate || 'Tahun Tidak Tersedia',
            price: price || 'Harga Tidak Tersedia',
            genre: genre || (bookData.categories ? bookData.categories[0] : 'Genre Tidak Tersedia'),
            conditionDescription: conditionDescription || 'Deskripsi Kondisi Tidak Tersedia',
            imageUrl: processedImageUrl || 'Gambar Tidak Tersedia'
          };

          try {
            const docRef = await addDoc(collection(db, 'books'), newBook);
            const responseBook = {
              message: 'Buku berhasil ditambahkan ke Firebase Firestore',
              book: {
                bookId: docRef.id,
                userId: newBook.userId,
                ownerName: newBook.ownerName,
                isbn: newBook.isbn,
                title: newBook.title,
                author: newBook.author,
                description: newBook.description,
                year: newBook.year,
                price: newBook.price,
                genre: newBook.genre,
                conditionDescription: newBook.conditionDescription,
                imageUrl: newBook.imageUrl
              }
            };
            res.status(201).send(responseBook);
          } catch (error) {
            console.error('Error menambahkan buku ke Firestore:', error);
            res.status(500).send({ error: 'Gagal menambahkan buku ke Firebase Firestore', details: error.message });
          }
        } catch (error) {
          console.error('Error mengirim permintaan ke Flask:', error);
          res.status(500).send({ error: 'Gagal memproses gambar dengan Flask', details: error.message });
        }
      });

      blobStream.end(req.file.buffer);
    } else {
      const newBook = {
        userId: userId,
        ownerName: userDisplayName,
        isbn: isbn,
        title: bookData.title,
        author: bookData.authors ? bookData.authors[0] : 'Penulis Tidak Diketahui',
        description: bookData.description || 'Deskripsi Tidak Tersedia',
        year: bookData.publishedDate || 'Tahun Tidak Tersedia',
        price: price || 'Harga Tidak Tersedia',
        genre: genre || (bookData.categories ? bookData.categories[0] : 'Genre Tidak Tersedia'),
        conditionDescription: conditionDescription || 'Deskripsi Kondisi Tidak Tersedia',
        imageUrl: 'Gambar Tidak Tersedia'
      };

      try {
        const docRef = await addDoc(collection(db, 'books'), newBook);
        const responseBook = {
          message: 'Buku berhasil ditambahkan ke Firebase Firestore',
          book: {
            bookId: docRef.id,
            userId: newBook.userId,
            ownerName: newBook.ownerName,
            isbn: newBook.isbn,
            title: newBook.title,
            author: newBook.author,
            description: newBook.description,
            year: newBook.year,
            price: newBook.price,
            genre: newBook.genre,
            conditionDescription: newBook.conditionDescription,
            imageUrl: newBook.imageUrl
          }
        };
        res.status(201).send(responseBook);
      } catch (error) {
        console.error('Error menambahkan buku ke Firestore:', error);
        res.status(500).send({ error: 'Gagal menambahkan buku ke Firebase Firestore', details: error.message });
      }
    }
  } catch (error) {
    console.error('Error menambahkan buku:', error);
    res.status(500).send({ error: 'Gagal menambahkan buku', details: error.message });
  }
});

// Route untuk memperbarui buku
app.put('/books/:id', authenticate, async (req, res) => {
  const bookId = req.params.id;
  const { price, conditionDescription } = req.body;

  try {
    const bookRef = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookRef);

    if (!bookSnapshot.exists()) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const updatedData = {};
    if (price) updatedData.price = price;
    if (conditionDescription) updatedData.conditionDescription = conditionDescription;

    await updateDoc(bookRef, updatedData);

    res.send({ message: 'Buku berhasil diperbarui' });
  } catch (error) {
    res.status(500).send({ error: 'Gagal memperbarui buku di Firebase Firestore' });
  }
});

app.get('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const bookDoc = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookDoc);

    if (bookSnapshot.exists()) {
      const bookData = bookSnapshot.data();
      res.send(bookData);
    } else {
      res.status(404).send({ error: 'Book not found' });
    }
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch book from Firebase Firestore' });
  }
});

// Route untuk menghapus buku
app.delete('/books/:id', authenticate, async (req, res) => {
  const bookId = req.params.id;

  try {
    const bookRef = doc(db, 'books', bookId);
    await deleteDoc(bookRef);
    res.send({ message: 'Buku berhasil dihapus' });
  } catch (error) {
    res.status(500).send({ error: 'Gagal menghapus buku dari Firebase Firestore' });
  }
});

app.get('/explore', authenticate, async (req, res) => {
  try {
    const booksRef = collection(db, 'books');
    const viewedBooksRef = collection(db, 'viewedBooks');

    // Dapatkan ID buku yang sudah dilihat oleh pengguna
    const viewedBooksQuery = query(viewedBooksRef, where('userId', '==', req.user.uid));
    const viewedBooksSnapshot = await getDocs(viewedBooksQuery);
    const viewedBooks = viewedBooksSnapshot.docs.map(doc => doc.data().bookId);

    // Dapatkan buku yang belum dilihat oleh pengguna dan bukan buku mereka sendiri
    const booksQuery = query(booksRef, where('userId', '!=', req.user.uid));
    const booksSnapshot = await getDocs(booksQuery);
    const books = booksSnapshot.docs.map(doc => ({
      id: doc.id,
      userId: doc.data().userId,
      ownerName: doc.data().ownerName, // Menambahkan ownerName ke data buku
      title: doc.data().title,
      author: doc.data().author,
      isbn: doc.data().isbn,
      price: doc.data().price,
      genre: doc.data().genre,
      conditionDescription: doc.data().conditionDescription,
      imageUrl: doc.data().imageUrl
    }));

    // Prioritaskan buku yang belum dilihat
    const unseenBooks = books.filter(book => !viewedBooks.includes(book.id));
    const book = unseenBooks.length > 0 ? unseenBooks[Math.floor(Math.random() * unseenBooks.length)] : books[Math.floor(Math.random() * books.length)];

    if (book) {
      // Simpan buku yang sudah dilihat oleh pengguna
      await addDoc(viewedBooksRef, {
        userId: req.user.uid,
        bookId: book.id,
        viewedAt: new Date()
      });

      res.send(book);
    } else {
      res.status(404).send({ message: 'Tidak ada buku yang tersedia untuk dieksplorasi' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Gagal mengeksplorasi buku' });
  }
});

app.post('/books/:bookId/like', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const bookId = req.params.bookId;

  try {
    const bookRef = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookRef);

    if (!bookSnapshot.exists()) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const bookData = bookSnapshot.data();

    // Jangan izinkan pengguna untuk like bukunya sendiri
    if (bookData.userId === userId) {
      return res.status(400).send({ error: 'Anda tidak bisa like buku Anda sendiri' });
    }

    // Periksa apakah pengguna sudah menyukai buku tersebut
    const likesRef = collection(db, 'likes');
    const likeQuerySnapshot = await getDocs(query(likesRef, where('bookId', '==', bookId), where('likerId', '==', userId)));

    if (!likeQuerySnapshot.empty) {
      return res.status(400).send({ error: 'Anda sudah menyukai buku ini' });
    }

    // Tambahkan like ke koleksi likes
    const likeData = {
      bookId: bookId,
      likerId: userId,
      ownerId: bookData.userId,
      createdAt: new Date()
    };

    await addDoc(likesRef, likeData);

    // Kirim notifikasi kepada pemilik buku
    // Asumsikan kita menyimpan notifikasi dalam koleksi "notifications"
    const notificationData = {
      userId: bookData.userId,
      message: `Buku Anda "${bookData.title}" mendapatkan like dari ${req.user.name || 'seorang pengguna'}`,
      createdAt: new Date(),
      read: false
    };

    await addDoc(collection(db, 'notifications'), notificationData);

    res.status(201).send({ message: 'Like berhasil dikirim' });
  } catch (error) {
    console.error('Error mengirim like:', error);
    res.status(500).send({ error: 'Gagal mengirim like' });
  }
});

// Route untuk mendapatkan notifikasi pengguna
app.get('/notifications', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const notificationsRef = collection(db, 'notifications');
    const querySnapshot = await getDocs(query(notificationsRef, where('userId', '==', userId)));
    const notifications = [];

    querySnapshot.forEach((doc) => {
      notifications.push({
        id: doc.id,
        message: doc.data().message,
        createdAt: doc.data().createdAt.toDate(),
        read: doc.data().read
      });
    });

    res.send(notifications);
  } catch (error) {
    res.status(500).send({ error: 'Gagal mendapatkan notifikasi' });
  }
});

app.get('/books/:bookId/likes', authenticate, async (req, res) => {
  const bookId = req.params.bookId;

  try {
    const likesRef = collection(db, 'likes');
    const querySnapshot = await getDocs(query(likesRef, where('bookId', '==', bookId)));

    const likers = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.createdAt) {
        likers.push({
          likerId: data.likerId,
          createdAt: data.createdAt.toDate()
        });
      } else {
        console.error('Data createdAt tidak ada atau kosong pada dokumen:', doc.id);
      }
    });

    // Mengembalikan daftar pengguna yang memberikan like
    res.status(200).send(likers);
  } catch (error) {
    console.error('Error mendapatkan daftar likers:', error);
    res.status(500).send({ error: 'Gagal mendapatkan daftar likers' });
  }
});

// Route untuk membuat percakapan baru
app.post('/chats', authenticate, async (req, res) => {
  const { participants } = req.body;

  try {
    const chatData = {
      participants: participants,
      createdAt: new Date()
    };

    const chatRef = await addDoc(collection(db, 'chats'), chatData);
    res.status(201).send({ message: 'Percakapan berhasil dibuat', chatId: chatRef.id });
  } catch (error) {
    res.status(500).send({ error: 'Gagal membuat percakapan' });
  }
});

// Route untuk mengirim pesan dalam percakapan
app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  const { chatId } = req.params;
  const { text } = req.body;
  const senderId = req.user ? req.user.uid : null;

  if (!text || typeof text !== 'string') {
    return res.status(400).send({ error: 'Teks pesan diperlukan dan harus berupa string' });
  }

  if (!senderId) {
    return res.status(400).send({ error: 'ID pengirim diperlukan' });
  }

  try {
    const chatDoc = doc(db, 'chats', chatId);
    const chatSnapshot = await getDoc(chatDoc);

    if (!chatSnapshot.exists()) {
      return res.status(404).send({ error: 'Percakapan tidak ditemukan' });
    }

    const chatData = chatSnapshot.data();
    if (!chatData.participants.includes(senderId)) {
      return res.status(403).send({ error: 'Anda bukan peserta dalam percakapan ini' });
    }

    const messageData = {
      senderId,
      text,
      createdAt: new Date()
    };

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesRef, messageData);

    res.status(201).send({ message: 'Pesan berhasil dikirim' });
  } catch (error) {
    res.status(500).send({ error: 'Gagal mengirim pesan' });
  }
});

// Route untuk menampilkan riwayat chat
app.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  const { chatId } = req.params;

  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const querySnapshot = await getDocs(messagesRef);
    const messages = [];

    querySnapshot.forEach((doc) => {
      messages.push({
        id: doc.id,
        senderId: doc.data().senderId,
        text: doc.data().text,
        createdAt: doc.data().createdAt.toDate()
      });
    });

    res.send(messages);
  } catch (error) {
    res.status(500).send({ error: 'Gagal mendapatkan pesan' });
  }
});

// Route untuk menampilkan profil pengguna
app.get('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(usersRef);
    let userData = null;

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userData = doc.data();
        userData.id = doc.id;
      }
    });

    if (!userData) {
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
    };

    const booksRef = collection(db, 'books');
    const booksQuerySnapshot = await getDocs(booksRef);
    const userBooks = [];

    booksQuerySnapshot.forEach((doc) => {
      if (doc.data().userId === userId) {
        userBooks.push({
          id: doc.id,
          title: doc.data().title,
          author: doc.data().author,
          isbn: doc.data().isbn,
        });
      }
    });

    orderedUserData.userBooks = userBooks;

    res.send(orderedUserData);
  } catch (error) {
    res.status(500).send({ error: 'Gagal mengambil profil pengguna' });
  }
});

// Route untuk menampilkan profil pengguna berdasarkan UID
app.get('/profile/:uid', authenticate, async (req, res) => {
  const requestedUid = req.params.uid;

  try {
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', requestedUid)));

    let userData = null;
    querySnapshot.forEach((doc) => {
      userData = doc.data();
      userData.id = doc.id;
    });

    if (!userData) {
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
    };

    const booksRef = collection(db, 'books');
    const booksQuerySnapshot = await getDocs(booksRef);
    const userBooks = [];

    booksQuerySnapshot.forEach((doc) => {
      if (doc.data().userId === requestedUid) {
        userBooks.push({
          id: doc.id,
          title: doc.data().title,
          author: doc.data().author,
          isbn: doc.data().isbn,
        });
      }
    });

    orderedUserData.userBooks = userBooks;

    res.send(orderedUserData);
  } catch (error) {
    console.error('Error mengambil profil pengguna berdasarkan UID:', error);
    res.status(500).send({ error: 'Gagal mengambil profil pengguna' });
  }
});


// Route untuk memperbarui profil pengguna
app.put('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { displayName, umur, pekerjaan, namaInstansi, favoriteBooks, password } = req.body;

  try {
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', userId)));
    let userDocId = null;

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userDocId = doc.id;
      }
    });

    if (!userDocId) {
      console.log(`Pengguna dengan UID ${userId} tidak ditemukan`);
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    const updateUser = {};
    if (displayName) updateUser.displayName = displayName;
    if (umur) updateUser.umur = umur;
    if (pekerjaan) updateUser.pekerjaan = pekerjaan;
    if (namaInstansi) updateUser.namaInstansi = namaInstansi;
    if (favoriteBooks) updateUser.favoriteBooks = favoriteBooks;

    await updateDoc(doc(db, 'users', userDocId), updateUser);

    if (password) {
      const user = await admin.auth().getUser(userId);
      await admin.auth().updateUser(userId, { password: password });
    }

    res.send({ message: 'Profil berhasil diperbarui' });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).send({ error: 'Gagal memperbarui profil' });
  }
});

// Route untuk menghapus profil pengguna
app.delete('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    // Hapus pengguna dari Firebase Authentication
    await admin.auth().deleteUser(userId);

    // Cari dan hapus pengguna dari Firestore
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', userId)));
    let userDocId = null;

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userDocId = doc.id;
      }
    });

    if (userDocId) {
      await deleteDoc(doc(db, 'users', userDocId));
    } else {
      console.log(`Pengguna dengan UID ${userId} tidak ditemukan di Firestore`);
      return res.status(404).send({ error: 'Pengguna tidak ditemukan di Firestore' });
    }

    res.send({ message: 'Profil berhasil dihapus' });
  } catch (error) {
    console.error('Error menghapus profil:', error);
    res.status(500).send({ error: 'Gagal menghapus profil' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
