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

    //User data untuk simpan ke firebase
    const userData = {
      uid: user.uid,
      displayName: displayName,
      umur: umur,
      pekerjaan: pekerjaan,
      namaInstansi: namaInstansi
    };

    //Tampilkan koleksi buku jika ada
    if (koleksiBuku) {
      userData.koleksiBuku = koleksiBuku;
    }

    // Save informasi user ke Firestore
    await addDoc(collection(db, 'users'), userData);

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

    // Ambil data buku dari Google Books API
    const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).send({ error: 'Book not found' });
    }
    const bookData = response.data.items[0].volumeInfo;

    // Save buku ke Firestore
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

// Route untuk menampilkan buku berdasarkan id
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


// Route untuk tampil semua buku
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

//Update Buku
app.put('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const { price, conditionDescription } = req.body;

    //Mengambil data buku yang sudah ada
    const bookRef = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookRef);

    if (!bookSnapshot.exists()) {
      return res.status(404).send({ error: 'Book not found' });
    }

    const updatedData = {};

    //Field yang ingin diizinkan untuk diupdate
    if (price) updatedData.price = price;
    if (conditionDescription) updatedData.conditionDescription = conditionDescription;

    //Update buku ke Firestore
    await updateDoc(bookRef, updatedData);

    res.send({ message: 'Book updated successfully in Firebase Firestore' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to update book in Firebase Firestore' });
  }
});


//Route untuk hapus buku berdasarka id
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

//Endpoint untuk membuat percakapan baru
app.post('/chats', authenticate, async (req, res) => {
  try {
    const { participants } = req.body;

    //Buat percakapan baru dengan data pengguna yang berpartisipasi
    const chatData = {
      participants: participants,
      createdAt: new Date()
    };

    //Simpan data percakapan ke koleksi "chats" di Firestore
    const chatRef = await addDoc(collection(db, 'chats'), chatData);

    res.status(201).send({ message: 'Conversation created successfully', chatId: chatRef.id });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).send({ error: 'Failed to create conversation' });
  }
});

app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  const { chatId } = req.params;
  const { text } = req.body;
  const senderId = req.user ? req.user.uid : null;

  console.log('Chat ID:', chatId);
  console.log('Text:', text);
  console.log('Sender ID:', senderId);

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
    console.error('Error sending message:', error.message, error.stack);
    res.status(500).send({ error: 'Failed to send message' });
  }
});


//Tampilkan history chat
app.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

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

//Endpoint untuk menampilkan profil dan buku
app.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Mencari pengguna di Firestore berdasarkan uid
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

    //Ambil buku-buku yang diunggah oleh pengguna
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

    // Menambahkan koleksi buku ke dalam profil pengguna
    orderedUserData.userBooks = userBooks;

    res.send(orderedUserData);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch user profile' });
  }
});


//Update user profile
app.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { displayName, umur, pekerjaan, namaInstansi, koleksiBuku, password } = req.body;

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

    const userRef = doc(db, 'users', userDocId);
    const updatedData = {};
    if (displayName) updatedData.displayName = displayName;
    if (umur) updatedData.umur = umur;
    if (pekerjaan) updatedData.pekerjaan = pekerjaan;
    if (namaInstansi) updatedData.namaInstansi = namaInstansi;
    if (koleksiBuku) updatedData.koleksiBuku = koleksiBuku;

    //Perbarui kata sandi
    if (password) {
      await admin.auth().updateUser(userId, { password: password });
    }

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
