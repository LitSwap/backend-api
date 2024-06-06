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
  apiKey: "-",
  authDomain: "-",
  projectId: "-",
  storageBucket: "-",
  messagingSenderId: "-",
  appId: "-",
  measurementId: "-"
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

    // Save additional user information to Firestore
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

// Route for adding a new book to Firestore using ISBN
app.post('/books', authenticate, async (req, res) => {
  try {
    const { isbn } = req.body;

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
  price: bookData.price || 'Unknown Price',
  synopsis: bookData.synopsis || 'No Synopsis Available',
  genre: bookData.genre || 'Unknown Genre',
  conditionDescription: bookData.conditionDescription || 'No Condition Description Available'
    });

    res.status(201).send({ message: 'Book added successfully to Firebase Firestore', bookId: docRef.id });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add book to Firebase Firestore' });
  }
});

// Route for fetching all books from Firestore
app.get('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const bookDoc = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookDoc);
    if (bookSnapshot.exists()) {
      res.send({ id: bookSnapshot.id, data: bookSnapshot.data() });
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
      books.push({ id: doc.id, data: doc.data() });
    });
    res.send(books);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch books from Firebase Firestore' });
  }
});

// Route for fetching a single book from Firestore by its Firestore ID
app.get('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const bookDoc = doc(db, 'books', bookId);
    const bookSnapshot = await getDoc(bookDoc);
    if (bookSnapshot.exists()) {
      res.send({ id: bookSnapshot.id, data: bookSnapshot.data() });
    } else {
      res.status(404).send({ error: 'Book not found' });
    }
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch book from Firebase Firestore' });
  }
});

// Route for updating an existing book in Firestore using ISBN
app.put('/books/:id', authenticate, async (req, res) => {
  try {
    const bookId = req.params.id;
    const { isbn, year, price, synopsis, genre, conditionDescription } = req.body;

    // Get updated book information from Google Books API
    const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).send({ error: 'Book not found' });
    }
    const bookData = response.data.items[0].volumeInfo;

    // Update book in Firestore
    const bookRef = doc(db, 'books', bookId);
    await updateDoc(bookRef, {
      userId: req.user.uid,
      isbn: isbn,
      title: bookData.title,
      author: bookData.authors ? bookData.authors[0] : 'Unknown Author',
      description: bookData.description || 'No Description Available',
      year: year || 'Unknown Year',
      price: price || 'Unknown Price',
      synopsis: synopsis || 'No Synopsis Available',
      genre: genre || 'Unknown Genre',
      conditionDescription: conditionDescription || 'No Condition Description Available'
    });

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

// Endpoint to create a new conversation
app.post('/chats', authenticate, async (req, res) => {
  try {
    const { participants } = req.body;

    // Create a new conversation with participating user data
    const chatData = {
      participants: participants,
      createdAt: new Date()
    };

    // Save the conversation data into the “chats” collection in Firestore
    const chatRef = await addDoc(collection(db, 'chats'), chatData);

    res.status(201).send({ message: 'Conversation created successfully', chatId: chatRef.id });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).send({ error: 'Failed to create conversation' });
  }
});

// Endpoint for sending new messages
app.post('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    const { chatId } = req.params;
    const { uid } = req.user;

    // Check if the user is included in the conversation participants
    const chatDoc = doc(db, 'chats', chatId);
    const chatSnapshot = await getDoc(chatDoc);
    if (!chatSnapshot.exists()) {
      return res.status(404).send({ error: 'Conversation not found' });
    }

    const chatData = chatSnapshot.data();
    if (!chatData.participants.includes(uid)) {
      return res.status(403).send({ error: 'Unauthorized to send message in this conversation' });
    }

    // Save message to Firestore collection
    const messageRef = await addDoc(collection(db, `chats/${chatId}/messages`), {
      senderId: uid,
      message: message,
      timestamp: new Date()
    });

    res.status(201).send({ message: 'Message sent successfully', messageId: messageRef.id });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// Endpoint for retrieving message history in a conversation
app.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { uid } = req.user;

    // Check if the user is included in the conversation participants
    const chatDoc = doc(db, 'chats', chatId);
    const chatSnapshot = await getDoc(chatDoc);
    if (!chatSnapshot.exists()) {
      return res.status(404).send({ error: 'Conversation not found' });
    }

    const chatData = chatSnapshot.data();
    if (!chatData.participants.includes(uid)) {
      return res.status(403).send({ error: 'Unauthorized to access messages in this conversation' });
    }

    // Retrieve message history in a conversation
    const messagesSnapshot = await getDocs(collection(db, `chats/${chatId}/messages`));
    const messages = [];
    messagesSnapshot.forEach((doc) => {
      messages.push({ id: doc.id, data: doc.data() });
    });
    res.send(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).send({ error: 'Failed to fetch messages' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
