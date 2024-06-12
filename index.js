const express = require('express');
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc } = require('firebase/firestore');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

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
  keyFilename: './bucketAccountKey.json', // Ganti dengan path ke file kunci layanan Anda
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const bucket = storage.bucket('books-litswap');

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Middleware otentikasi
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).send({ error: 'Unauthorized' });
  }
};

// Validator untuk registrasi
const validateRegister = [
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('displayName').notEmpty().withMessage('Display name is required'),
  body('umur').isInt({ min: 0 }).withMessage('Umur must be a positive integer'),
  body('pekerjaan').notEmpty().withMessage('Pekerjaan is required'),
  body('namaInstansi').notEmpty().withMessage('Nama Instansi is required'),
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
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
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
  body('isbn').notEmpty().withMessage('ISBN is required'),
  body('price').optional().isNumeric().withMessage('Price must be a number'),
  body('genre').optional().notEmpty().withMessage('Genre cannot be empty'),
  body('conditionDescription').optional().notEmpty().withMessage('Condition description cannot be empty'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

// Route untuk registrasi pengguna
app.post('/register', validateRegister, async (req, res) => {
  const { email, password, displayName, umur, pekerjaan, namaInstansi, koleksiBuku } = req.body;

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
      koleksiBuku: koleksiBuku || []
    };

    await addDoc(collection(db, 'users'), userData);

    res.status(201).send({ message: 'User created successfully', user });
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

  try {
    const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).send({ error: 'Buku tidak ditemukan' });
    }

    const bookData = response.data.items[0].volumeInfo;

    // Unggah gambar ke Google Cloud Storage
    let imageUrl = null;
    if (req.file) {
      try {
        console.log('Memulai pengunggahan gambar ke Google Cloud Storage');
        const blob = bucket.file(`bookImages/${Date.now()}_${req.file.originalname}`);
        console.log('Referensi penyimpanan dibuat:', blob.name);
        const blobStream = blob.createWriteStream();

        blobStream.on('error', (err) => {
          console.error('Kesalahan saat mengunggah gambar ke Google Cloud Storage:', err);
          return res.status(500).send({ error: 'Gagal mengunggah gambar ke Google Cloud Storage', details: err.message });
        });

        blobStream.on('finish', async () => {
          imageUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
          console.log('URL gambar diperoleh:', imageUrl);

          const newBook = {
            userId: req.user.uid,
            isbn: isbn,
            title: bookData.title,
            author: bookData.authors ? bookData.authors[0] : 'Penulis Tidak Diketahui',
            description: bookData.description || 'Deskripsi Tidak Tersedia',
            year: bookData.publishedDate || 'Tahun Tidak Diketahui',
            price: price || 'Harga Tidak Diketahui',
            genre: genre || 'Genre Tidak Diketahui',
            conditionDescription: conditionDescription || 'Deskripsi Kondisi Tidak Tersedia',
            imageUrl: imageUrl || 'Gambar Tidak Tersedia'
          };

          const docRef = await addDoc(collection(db, 'books'), newBook);
          const responseBook = {
            message: 'Buku berhasil ditambahkan ke Firebase Firestore',
            book: {
              bookId: docRef.id,
              userId: newBook.userId,
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
        });

        blobStream.end(req.file.buffer);
      } catch (storageError) {
        console.error('Kesalahan saat mengunggah gambar ke Google Cloud Storage:', storageError);
        return res.status(500).send({ error: 'Gagal mengunggah gambar ke Google Cloud Storage', details: storageError.message });
      }
    } else {
      const newBook = {
        userId: req.user.uid,
        isbn: isbn,
        title: bookData.title,
        author: bookData.authors ? bookData.authors[0] : 'Penulis Tidak Diketahui',
        description: bookData.description || 'Deskripsi Tidak Tersedia',
        year: bookData.publishedDate || 'Tahun Tidak Diketahui',
        price: price || 'Harga Tidak Diketahui',
        genre: genre || 'Genre Tidak Diketahui',
        conditionDescription: conditionDescription || 'Deskripsi Kondisi Tidak Tersedia',
        imageUrl: 'Gambar Tidak Tersedia'
      };

      const docRef = await addDoc(collection(db, 'books'), newBook);
      const responseBook = {
        message: 'Buku berhasil ditambahkan ke Firebase Firestore',
        book: {
          bookId: docRef.id,
          userId: newBook.userId,
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
    }
  } catch (error) {
    console.error('Kesalahan saat menambahkan buku ke Firestore:', error);  // Log kesalahan
    res.status(500).send({ error: 'Gagal menambahkan buku ke Firebase Firestore', details: error.message });
  }
});


// Route untuk menampilkan buku berdasarkan id
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

// Route untuk menampilkan semua buku
app.get('/books', authenticate, async (req, res) => {
  try {
    const booksSnapshot = await getDocs(collection(db, 'books'));
    const books = [];

    booksSnapshot.forEach((doc) => {
      const bookData = doc.data();
      bookData.id = doc.id;
      books.push(bookData);
    });

    res.send(books);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch books from Firebase Firestore' });
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
      return res.status(404).send({ error: 'Book not found' });
    }

    const updatedData = {};
    if (price) updatedData.price = price;
    if (conditionDescription) updatedData.conditionDescription = conditionDescription;

    await updateDoc(bookRef, updatedData);

    res.send({ message: 'Book updated successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to update book in Firebase Firestore' });
  }
});

// Route untuk menghapus buku
app.delete('/books/:id', authenticate, async (req, res) => {
  const bookId = req.params.id;

  try {
    const bookRef = doc(db, 'books', bookId);
    await deleteDoc(bookRef);
    res.send({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to delete book from Firebase Firestore' });
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
    res.status(201).send({ message: 'Conversation created successfully', chatId: chatRef.id });
  } catch (error) {
    res.status(500).send({ error: 'Failed to create conversation' });
  }
});

// Route untuk mengirim pesan dalam percakapan
app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  const { chatId } = req.params;
  const { text } = req.body;
  const senderId = req.user ? req.user.uid : null;

  if (!text || typeof text !== 'string') {
    return res.status(400).send({ error: 'Message text is required and should be a string' });
  }

  if (!senderId) {
    return res.status(400).send({ error: 'Sender ID is required' });
  }

  try {
    const chatDoc = doc(db, 'chats', chatId);
    const chatSnapshot = await getDoc(chatDoc);

    if (!chatSnapshot.exists()) {
      return res.status(404).send({ error: 'Chat not found' });
    }

    const chatData = chatSnapshot.data();
    if (!chatData.participants.includes(senderId)) {
      return res.status(403).send({ error: 'You are not a participant in this chat' });
    }

    const messageData = {
      senderId,
      text,
      createdAt: new Date()
    };

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesRef, messageData);

    res.status(201).send({ message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// Route untuk menampilkan history chat
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
    res.status(500).send({ error: 'Failed to get messages' });
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
      return res.status(404).send({ error: 'User not found' });
    }

    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
      koleksiBuku: userData.koleksiBuku      
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
    res.status(500).send({ error: 'Failed to fetch user profile' });
  }
});

// Route untuk memperbarui profil pengguna
app.put('/profile', authenticate, async (req, res) => {
  const userId = req.user.uid;
  const { displayName, umur, pekerjaan, namaInstansi, koleksiBuku, password } = req.body;

  try {
    const usersRef = collection(db, 'users');
    const querySnapshot = await getDocs(usersRef);
    let userDocId = null;

    querySnapshot.forEach((doc) => {
      if (doc.data().uid === userId) {
        userDocId = doc.id;
      }
    });

    if (!userDocId) {
      return res.status(404).send({ error: 'User not found' });
    }

    const updateUser = {};
    if (displayName) updateUser.displayName = displayName;
    if (umur) updateUser.umur = umur;
    if (pekerjaan) updateUser.pekerjaan = pekerjaan;
    if (namaInstansi) updateUser.namaInstansi = namaInstansi;
    if (koleksiBuku) updateUser.koleksiBuku = koleksiBuku;

    await updateDoc(doc(db, 'users', userDocId), updateUser);

    if (password) {
      const user = await admin.auth().getUser(userId);
      await admin.auth().updateUser(userId, { password: password });
    }

    res.send({ message: 'Profile updated successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to update profile' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
