const express = require('express');
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc } = require('firebase/firestore');
const axios = require('axios');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firebaseConfig = {
  apiKey: "AIzaSyAH5PD5HPuZCOeiYwjUPD9VMAEQicSmG8Y",
  authDomain: "litswap-project.firebaseapp.com",
  projectId: "litswap-project",
  storageBucket: "litswap-project.appspot.com",
  messagingSenderId: "357232983996",
  appId: "1:357232983996:web:2e6ad86aa459e1fde535b9",
  measurementId: "G-DDPRTXB3H2"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const app = express();
app.use(express.json());

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

app.post('/register', async (req, res) => {
  const { email, password, displayName, umur, pekerjaan, namaInstansi, koleksiBuku } = req.body;

  try {
    const user = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName,
    });

    // Simpan informasi tambahan pengguna ke Firestore
    await addDoc(collection(db, 'users'), {
      uid: user.uid,
      displayName: displayName,
      umur: umur,
      pekerjaan: pekerjaan,
      namaInstansi: namaInstansi,
      koleksiBuku: koleksiBuku
    });

    res.status(201).send({ message: 'User created successfully', user });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    res.send({ token });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post('/google-login', async (req, res) => {
  const { token } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const user = await admin.auth().getUser(decodedToken.uid);
    res.send({ message: 'User authenticated successfully', user });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post('/books', authenticate, async (req, res) => {
  try {
    const { isbn, price, genre, conditionDescription } = req.body;

    // Get book information from Google Books API
    const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).send({ error: 'Book not found' });
    }
    const bookData = response.data.items[0].volumeInfo;

    // Save book to Firestore
    const docRef = await addDoc(collection(db, 'books'), {
      userId: req.user.uid,
      isbn: isbn,
      title: bookData.title,
      author: bookData.authors ? bookData.authors[0] : 'Unknown Author',
      description: bookData.description || 'No Description Available',
      year: bookData.publishedDate || 'Unknown Year',
      price: price || 'Unknown Price',
      synopsis: bookData.synopsis || 'No Synopsis Available',
      genre: genre || 'Unknown Genre',
      conditionDescription: conditionDescription || 'No Condition Description Available'
    });

    res.status(201).send({ message: 'Book added successfully to Firebase Firestore', bookId: docRef.id });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add book to Firebase Firestore' });
  }
});

// Route for fetching a single book from Firestore by its Firestore ID
app.get('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const bookDoc = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookDoc);
    
    if (bookSnapshot.exists()) {
      const bookData = bookSnapshot.data();
      const sortedBookData = {
        id: bookSnapshot.id,
        userId: bookData.userId,
        isbn: bookData.isbn,
        title: bookData.title,
        author: bookData.author,
        description: bookData.description,
        year: bookData.year,
        price: bookData.price,
        synopsis: bookData.synopsis,
        genre: bookData.genre,
        conditionDescription: bookData.conditionDescription
      };

      res.send(sortedBookData);
    } else {
      res.status(404).send({ error: 'Book not found' });
    }
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch book from Firebase Firestore' });
  }
});


// Route for fetching all books from Firestore
app.get('/books', authenticate, async (req, res) => {
  try {
    const booksSnapshot = await getDocs(collection(db, 'books'));
    const books = [];

    booksSnapshot.forEach((doc) => {
      const bookData = doc.data();
      const sortedBookData = {
        id: doc.id,
        userId: bookData.userId,
        isbn: bookData.isbn,
        title: bookData.title,
        author: bookData.author,
        description: bookData.description,
        year: bookData.year,
        price: bookData.price,
        synopsis: bookData.synopsis,
        genre: bookData.genre,
        conditionDescription: bookData.conditionDescription
      };
      books.push(sortedBookData);
    });

    res.send(books);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch books from Firebase Firestore' });
  }
});

// Route for updating a book in Firestore
app.put('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const { price, conditionDescription } = req.body; // Hanya field yang ingin diizinkan untuk diupdate

    // Get the existing book document
    const bookRef = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookRef);

    if (!bookSnapshot.exists()) {
      return res.status(404).send({ error: 'Book not found' });
    }

    const updatedData = {};

    // Menyertakan field yang ingin diizinkan untuk diupdate
    if (price) updatedData.price = price;
    if (conditionDescription) updatedData.conditionDescription = conditionDescription;

    // Update book in Firestore
    await updateDoc(bookRef, updatedData);

    res.send({ message: 'Book updated successfully in Firebase Firestore' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to update book in Firebase Firestore' });
  }
});


// Route for deleting a book from Firestore by its Firestore ID
app.delete('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const bookRef = doc(db, 'books', bookId);
    await deleteDoc(bookRef);
    res.send({ message: 'Book deleted successfully from Firebase Firestore' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to delete book from Firebase Firestore' });
  }
});

// Endpoint untuk membuat percakapan baru
app.post('/chats', authenticate, async (req, res) => {
  try {
    const { participants } = req.body;

    // Buat percakapan baru dengan data pengguna yang berpartisipasi
    const chatData = {
      participants: participants,
      createdAt: new Date()
    };

    // Simpan data percakapan ke dalam koleksi "chats" di Firestore
    const chatRef = await addDoc(collection(db, 'chats'), chatData);

    res.status(201).send({ message: 'Conversation created successfully', chatId: chatRef.id });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).send({ error: 'Failed to create conversation' });
  }
});

// Endpoint untuk mengirim pesan baru
app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { senderId, text } = req.body;

    // Buat pesan baru dengan data yang diberikan
    const messageData = {
      senderId: senderId,
      text: text,
      createdAt: new Date()
    };

    // Simpan pesan ke dalam subkoleksi "messages" dalam dokumen percakapan
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesRef, messageData);

    res.status(201).send({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// Endpoint untuk mendapatkan pesan-pesan dalam suatu percakapan
app.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    // Ambil pesan-pesan dari subkoleksi "messages" dalam dokumen percakapan
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

    res.status(200).send(messages);
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).send({ error: 'Failed to get messages' });
  }
});

// Endpoint untuk mendapatkan profil pengguna
app.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Cari pengguna di Firestore berdasarkan uid
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

    // Atur urutan field sesuai keinginan Anda
    const orderedUserData = {
      uid: userData.uid,
      displayName: userData.displayName,
      namaInstansi: userData.namaInstansi,
      umur: userData.umur,
      pekerjaan: userData.pekerjaan,
      koleksiBuku: userData.koleksiBuku      
    };

    res.send(orderedUserData);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch user profile' });
  }
});

// Endpoint untuk memperbarui profil pengguna
app.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { displayName, umur, pekerjaan, namaInstansi, koleksiBuku } = req.body;

    // Cari pengguna di Firestore berdasarkan uid
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

    // Perbarui informasi pengguna
    const userRef = doc(db, 'users', userDocId);
    const updatedData = {};
    if (displayName) updatedData.displayName = displayName;
    if (umur) updatedData.umur = umur;
    if (pekerjaan) updatedData.pekerjaan = pekerjaan;
    if (namaInstansi) updatedData.namaInstansi = namaInstansi;
    if (koleksiBuku) updatedData.koleksiBuku = koleksiBuku;

    await updateDoc(userRef, updatedData);

    res.send({ message: 'User profile updated successfully' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to update user profile' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
