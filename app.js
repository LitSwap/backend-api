const express = require('express');
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc, query, where, orderBy } = require('firebase/firestore');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();
const FormData = require('form-data');
const fs = require('fs');
const appmlEndpoint = 'https://book-recommendation-dot-litswap-project.et.r.appspot.com/recommend'; 

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
const bucket = storage.bucket('your-storage-bucket');

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
  body('sosialMedia').optional().isString().withMessage('Sosial media harus berupa string'),
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
  const { email, password, displayName, umur, pekerjaan, namaInstansi, sosialMedia } = req.body;

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
      namaInstansi: namaInstansi,
      sosialMedia: sosialMedia
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

// Route untuk melihat buku berdasarkan id
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

// Route untuk menampilkan semua buku
app.get('/books', authenticate, async (req, res) => {
  try {
    const booksRef = collection(db, 'books');
    const querySnapshot = await getDocs(booksRef);
    const books = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      books.push({
        id: doc.id,
        userId: data.userId,
        ownerName: data.ownerName,
        isbn: data.isbn,
        title: data.title,
        author: data.author,
        description: data.description,
        year: data.year,
        price: data.price,
        genre: data.genre,
        conditionDescription: data.conditionDescription,
        imageUrl: data.imageUrl,
      });
    });

    if (books.length === 0) {
      return res.send({ message: 'Tidak ada buku' });
    }

    res.send(books);
  } catch (error) {
    console.error('Error fetching all books:', error);
    res.status(500).send({ error: 'Gagal mendapatkan semua buku' });
  }
});

//Route untuk menampilkan buku tanpa auth 
app.get('/booksnoauth', async (req, res) => {
  try {
    const booksRef = collection(db, 'books');
    const querySnapshot = await getDocs(booksRef);
    const books = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      books.push({
        id: doc.id,
        userId: data.userId,
        ownerName: data.ownerName,
        isbn: data.isbn,
        title: data.title,
        author: data.author,
        description: data.description,
        year: data.year,
        price: data.price,
        genre: data.genre,
        conditionDescription: data.conditionDescription,
        imageUrl: data.imageUrl,
      });
    });

    if (books.length === 0) {
      return res.send({ message: 'Tidak ada buku' });
    }

    res.send(books);
  } catch (error) {
    console.error('Error fetching all books:', error);
    res.status(500).send({ error: 'Gagal mendapatkan semua buku' });
  }
});


// Route untuk menambah buku favorit
app.post('/favorite_books', authenticate, async (req, res) => {
  const { isbn } = req.body;
  const userId = req.user.uid;

  try {
    const favoriteBooksRef = collection(db, 'favorite_books');
    const favoriteBooksQuerySnapshot = await getDocs(query(favoriteBooksRef, where('userId', '==', userId), where('isbn', '==', isbn)));

    if (!favoriteBooksQuerySnapshot.empty) {
      return res.status(400).send({ error: 'Buku ini sudah ada dalam daftar favorit Anda' });
    }

    const booksRef = collection(db, 'books');
    const booksQuerySnapshot = await getDocs(query(booksRef, where('isbn', '==', isbn)));
    
    if (booksQuerySnapshot.empty) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const bookData = booksQuerySnapshot.docs[0].data();

    const newFavoriteBook = {
      userId: userId,
      isbn: isbn,
      title: bookData.title,
      author: bookData.author,
      description: bookData.description,
      year: bookData.year,
      genre: bookData.genre
    };

    const docRef = await addDoc(collection(db, 'favorite_books'), newFavoriteBook);
    res.status(201).send({ message: 'Buku berhasil ditambahkan ke daftar favorit', favoriteBookId: docRef.id });
  } catch (error) {
    console.error('Error menambahkan buku favorit:', error);
    res.status(500).send({ error: 'Gagal menambahkan buku ke daftar favorit', details: error.message });
  }
});

// Route untuk melihat daftar buku favorit pengguna
app.get('/favorite_books', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    const favoriteBooksRef = collection(db, 'favorite_books');
    const favoriteBooksQuerySnapshot = await getDocs(query(favoriteBooksRef, where('userId', '==', userId)));

    const favoriteBooks = [];
    favoriteBooksQuerySnapshot.forEach((doc) => {
      const data = doc.data();
      favoriteBooks.push({
        id: doc.id,
        isbn: data.isbn,
        title: data.title,
        author: data.author,
        description: data.description,
        year: data.year,
        genre: data.genre
      });
    });

    if (favoriteBooks.length === 0) {
      return res.send({ message: 'Tidak ada buku favorit' });
    }

    res.send(favoriteBooks);
  } catch (error) {
    console.error('Error fetching favorite books:', error);
    res.status(500).send({ error: 'Gagal mendapatkan daftar buku favorit' });
  }
});




// Route untuk explore buku
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
    let books = booksSnapshot.docs.map(doc => ({
      id: doc.id,
      userId: doc.data().userId,
      ownerName: doc.data().ownerName, // Menambahkan ownerName ke data buku
      title: doc.data().title,
      author: doc.data().author,
      isbn: doc.data().isbn,
      price: doc.data().price,
      genre: doc.data().genre,
      conditionDescription: doc.data().conditionDescription,
      imageUrl: doc.data().imageUrl,
    }));

    // Prioritaskan buku yang belum dilihat
    const unseenBooks = books.filter(book => !viewedBooks.includes(book.id));

    // Jika ada buku yang belum dilihat
    if (unseenBooks.length > 0) {
      try {
        // Kirim permintaan ke appml.py untuk mendapatkan rekomendasi
        const response = await axios.post(appmlEndpoint, {
          favorite_books: unseenBooks.map(book => book.isbn), // Kirim ISBN dari buku-buku yang belum dilihat
          n_recommendations: 5,
        });

        const recommendedBooks = response.data;
        console.log('Eksplorasi buku berdasarkan rekomendasi');

        // Masukkan buku rekomendasi ke dalam awal daftar buku yang belum dilihat
        books = [...recommendedBooks, ...unseenBooks];
      } catch (error) {
        console.error('Gagal mendapatkan rekomendasi dari book recomendation:', error.message);
        console.log('Eksplorasi buku tidak berdasarkan rekomendasi');
        // Jika gagal mendapatkan rekomendasi, tetap gunakan daftar buku yang belum dilihat
      }
    }

    let book;
    if (books.length > 0) {
      // Pilih buku secara acak dari daftar buku yang sudah disusun
      book = books[Math.floor(Math.random() * books.length)];

      // Simpan buku yang sudah dilihat oleh pengguna
      await addDoc(viewedBooksRef, {
        userId: req.user.uid,
        bookId: book.id,
        viewedAt: new Date(),
      });
    } else {
      // Jika tidak ada buku yang bisa dieksplorasi
      return res.status(404).send({ message: 'Tidak ada buku yang tersedia untuk dieksplorasi' });
    }

    res.send(book);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Gagal mengeksplorasi buku' });
  }
});


// Route untuk menyukai buku 
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
      likerName: `${req.user.name || 'seorang pengguna'}`,
      ownerId: bookData.userId,
      createdAt: new Date()
    };

    await addDoc(likesRef, likeData);

    // Kirim notifikasi kepada pemilik buku
    const notificationData = {
      userId: bookData.userId,
      message: `Buku Anda "${bookData.title}" mendapatkan like dari ${req.user.name || 'seorang pengguna'}`,
      createdAt: new Date(),
      status: 'pending',
      senderId: userId,  // Tambahkan senderId
      senderName: `${req.user.name || 'seorang pengguna'}`
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
    // Order by createdAt in descending order
    const q = query(notificationsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    const notifications = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const notification = {
        id: doc.id,
        message: data.message,
        createdAt: data.createdAt.toDate(),
        read: data.read,
      };

      if (data.barterRequestId) {
        notification.barterRequestId = data.barterRequestId;
      }

      notifications.push(notification);
    });

    if (notifications.length === 0) {
      return res.send({ message: 'Tidak ada notifikasi' });
    }

    res.send(notifications);
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).send({ error: 'Gagal mendapatkan notifikasi' });
  }
});

// Route untuk menerima notifikasi like
app.put('/notifications/:notificationId/accept', authenticate, async (req, res) => {
  const notificationId = req.params.notificationId;

  try {
    // Perbarui status notifikasi menjadi 'accepted'
    await updateDoc(doc(db, 'notifications', notificationId), { status: 'accepted' });

    // Ambil informasi notifikasi
    const notificationSnapshot = await getDoc(doc(db, 'notifications', notificationId));
    const notificationData = notificationSnapshot.data();

    // Redirect ke profil likers dalam aplikasi
    res.redirect(`/profile/${notificationData.senderId}`);
  } catch (error) {
    console.error('Error saat menerima notifikasi:', error);
    res.status(500).send({ error: 'Gagal menerima notifikasi' });
  }
});

// Route untuk menolak notifikasi like
app.put('/notifications/:notificationId/reject', authenticate, async (req, res) => {
  const notificationId = req.params.notificationId;

  try {
    // Perbarui status notifikasi menjadi 'rejected'
    await updateDoc(doc(db, 'notifications', notificationId), { status: 'rejected' });

    res.send({ message: 'Anda menolak match dengan pengguna ini' });
  } catch (error) {
    console.error('Error saat menolak notifikasi:', error);
    res.status(500).send({ error: 'Gagal menolak notifikasi' });
  }
});

// Route untuk membuat barter request
app.post('/barter/:notificationId', authenticate, async (req, res) => {
  const notificationId = req.params.notificationId;
  const { selectedBookId } = req.body; // ID buku yang dipilih oleh pengguna

  try {
    // Ambil informasi notifikasi
    const notificationSnapshot = await getDoc(doc(db, 'notifications', notificationId));
    const notificationData = notificationSnapshot.data();

    if (!notificationData) {
      return res.status(404).send({ error: 'Notifikasi tidak ditemukan' });
    }

    // Pengecekan apakah sudah ada barter request yang berulang
    const existingBarterQuery = query(collection(db, 'barter_requests'), where('requesterId', '==', req.user.uid), where('responderId', '==', notificationData.senderId), where('requestedBookId', '==', selectedBookId), where('status', 'in', ['pending', 'accepted']));
    const existingBarterSnapshot = await getDocs(existingBarterQuery);

    if (!existingBarterSnapshot.empty) {
      return res.status(400).send({ error: 'Barter request sudah ada untuk buku ini dengan pengguna ini' });
    }

    // Ambil judul buku berdasarkan ID buku
    const bookSnapshot = await getDoc(doc(db, 'books', selectedBookId));
    const bookData = bookSnapshot.data();

    if (!bookData) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const bookTitle = bookData.title;

    // Buat barter request
    const barterRequest = {
      requesterId: req.user.uid,
      requesterName: req.user.name || 'Seorang pengguna',
      responderId: notificationData.senderId,
      requestedBookId: selectedBookId,
      status: 'pending',
      createdAt: new Date()
    };

    // Simpan barter request ke Firestore
    const barterRef = await addDoc(collection(db, 'barter_requests'), barterRequest);

    // Kirim notifikasi kepada responder
    const notificationMessage = `${barterRequest.requesterName} ingin melakukan barter dengan buku "${bookTitle}"`;
    const notificationDataResponder = {
      userId: notificationData.senderId,
      message: notificationMessage,
      createdAt: new Date(),
      read: false,
      senderId: req.user.uid,  // Tambahkan senderId untuk identifikasi pengirim notifikasi
      barterRequestId: barterRef.id
    };

    await addDoc(collection(db, 'notifications'), notificationDataResponder);

    res.send({ message: 'Barter request dibuat dan notifikasi dikirim', barterRequestId: barterRef.id });
  } catch (error) {
    console.error('Error membuat barter request:', error);
    res.status(500).send({ error: 'Gagal membuat barter request' });
  }
});

// Route untuk menerima barter
app.put('/barter/:barterRequestId/accept', authenticate, async (req, res) => {
  const barterRequestId = req.params.barterRequestId;

  try {
    // Perbarui status barter menjadi 'accepted'
    await updateDoc(doc(db, 'barter_requests', barterRequestId), { status: 'accepted' });

    // Ambil informasi barter request
    const barterRequestSnapshot = await getDoc(doc(db, 'barter_requests', barterRequestId));
    const barterRequestData = barterRequestSnapshot.data();

    if (!barterRequestData) {
      return res.status(404).send({ error: 'Barter request tidak ditemukan' });
    }

    // Ambil informasi pengguna dari Firestore untuk mendapatkan nama pengguna berdasarkan uid
    const requesterQuery = query(collection(db, 'users'), where('uid', '==', barterRequestData.requesterId));
    const responderQuery = query(collection(db, 'users'), where('uid', '==', barterRequestData.responderId));

    const requesterSnapshot = await getDocs(requesterQuery);
    const responderSnapshot = await getDocs(responderQuery);

    if (requesterSnapshot.empty || responderSnapshot.empty) {
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    const requesterData = requesterSnapshot.docs[0].data();
    const responderData = responderSnapshot.docs[0].data();

    const requesterName = requesterData.displayName || 'Seorang pengguna';
    const responderName = responderData.displayName || 'Seorang pengguna';

    const requesterSosmed = requesterData.sosialMedia || 'Seorang pengguna';
    const responderSosmed = responderData.sosialMedia || 'Seorang pengguna';

    // Kirim notifikasi match ke requester
    const notificationDataForRequester = {
      message: `Anda telah match dengan ${responderName}, Sosial Media pengguna : ${responderSosmed}`,
      userId: barterRequestData.requesterId,
      createdAt: new Date(),
      read: false
    };
    await addDoc(collection(db, 'notifications'), notificationDataForRequester);

    // Kirim notifikasi match ke responder
    const notificationDataForResponder = {
      message: `Anda telah match dengan ${requesterName}, Sosial Media pengguna : ${requesterSosmed}`,
      userId: barterRequestData.responderId,
      createdAt: new Date(),
      read: false
    };
    await addDoc(collection(db, 'notifications'), notificationDataForResponder);

    res.send({ message: 'Barter diterima dan notifikasi match dikirim' });
  } catch (error) {
    console.error('Error menerima barter:', error);
    res.status(500).send({ error: 'Gagal menerima barter' });
  }
});

// Route untuk menolak barter
app.put('/barter/:barterRequestId/reject', authenticate, async (req, res) => {
  const barterRequestId = req.params.barterRequestId;

  try {
    // Perbarui status barter menjadi 'rejected'
    await updateDoc(doc(db, 'barter_requests', barterRequestId), { status: 'rejected' });

    res.send({ message: 'Barter ditolak' });
  } catch (error) {
    console.error('Error menolak barter:', error);
    res.status(500).send({ error: 'Gagal menolak barter' });
  }
});



// Route untuk menampilkan profil pengguna (diri sendiri)
app.get('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;

  try {
    // Query to get the user document based on uid
    const usersQuery = query(collection(db, 'users'), where('uid', '==', userId));
    const userSnapshot = await getDocs(usersQuery);
    let userData = null;

    // Extract user data from the query snapshot
    userSnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userData = doc.data();
        userData.id = doc.id;
      }
    });

    // If user not found, return 404 error
    if (!userData) {
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    // Prepare the ordered user data
    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
      sosialMedia: userData.sosialMedia
    };

    // Query to get the books associated with the user
    const booksQuery = query(collection(db, 'books'), where('userId', '==', userId));
    const booksSnapshot = await getDocs(booksQuery);
    const userBooks = [];

    // Extract books data from the query snapshot
    booksSnapshot.forEach((doc) => {
      userBooks.push({
        id: doc.id,
        title: doc.data().title,
        author: doc.data().author,
        isbn: doc.data().isbn,
        price: doc.data().price,
        genre: doc.data().genre,
        conditionDescription: doc.data().conditionDescription,
        imageUrl: doc.data().imageUrl,
      });
    });

    // Add userBooks to the ordered user data
    orderedUserData.userBooks = userBooks;

    // Send the user profile data as a response
    res.send(orderedUserData);
  } catch (error) {
    console.error('Error mengambil profil pengguna:', error);
    res.status(500).send({ error: 'Gagal mengambil profil pengguna' });
  }
});

// Route untuk menampilkan profil pengguna berdasarkan UID
app.get('/profile/:uid', authenticate, async (req, res) => {
  const requestedUid = req.params.uid;

  try {
    // Query to get the user document based on uid
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', requestedUid)));

    let userData = null;
    // Extract user data from the query snapshot
    querySnapshot.forEach((doc) => {
      userData = doc.data();
      userData.id = doc.id;
    });

    // If user not found, return 404 error
    if (!userData) {
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    // Prepare the ordered user data
    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
      sosialMedia: userData.sosialMedia
    };

    // Query to get the books associated with the user
    const booksRef = collection(db, 'books');
    const booksQuerySnapshot = await getDocs(query(booksRef, where('userId', '==', requestedUid)));

    const userBooks = [];
    // Extract books data from the query snapshot
    booksQuerySnapshot.forEach((doc) => {
      userBooks.push({
        id: doc.id,
        title: doc.data().title,
        author: doc.data().author,
        isbn: doc.data().isbn,
        price: doc.data().price,
        genre: doc.data().genre,
        conditionDescription: doc.data().conditionDescription,
        imageUrl: doc.data().imageUrl,
      });
    });

    // Add userBooks to the ordered user data
    orderedUserData.userBooks = userBooks;

    // Send the user profile data as a response
    res.send(orderedUserData);
  } catch (error) {
    console.error('Error mengambil profil pengguna berdasarkan UID:', error);
    res.status(500).send({ error: 'Gagal mengambil profil pengguna' });
  }
});

// Route untuk memperbarui profil pengguna
app.put('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { displayName, umur, pekerjaan, namaInstansi, favoriteBooks, sosialMedia, password } = req.body;

  try {
    // Query to find the user's document ID
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(query(usersRef, where('uid', '==', userId)));
    let userDocId = null;

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userDocId = doc.id;
      }
    });

    // If user not found, return 404 error
    if (!userDocId) {
      console.log(`Pengguna dengan UID ${userId} tidak ditemukan`);
      return res.status(404).send({ error: 'Pengguna tidak ditemukan' });
    }

    // Create an object with the fields to be updated
    const updateUser = {};
    if (displayName) updateUser.displayName = displayName;
    if (umur) updateUser.umur = umur;
    if (pekerjaan) updateUser.pekerjaan = pekerjaan;
    if (namaInstansi) updateUser.namaInstansi = namaInstansi;
    if (favoriteBooks) updateUser.favoriteBooks = favoriteBooks;
    if (sosialMedia) updateUser.sosialMedia = sosialMedia;

    // Update the user's document in the database
    await updateDoc(doc(db, 'users', userDocId), updateUser);

    // Update the user's password if provided
    if (password) {
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



const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
