# backend-api LitSwap
## Cloud Computing Path 
Creating backend API and deploy using [app engine](https://cloud.google.com/appengine?_gl=1*hlianx*_up*MQ..&gclid=CjwKCAjw1K-zBhBIEiwAWeCOF0RgPyusDHXwr4GMj_qUf92_5kwVHtr3KnJjYifHUEzOZYjq53jQuRoCcYoQAvD_BwE&gclsrc=aw.ds), to connect backend API with machine learning model API and Mobile Development project. Creating a database on [firebase firestore](https://firebase.google.com/docs/firestore) to store data and use [google cloud storage](https://cloud.google.com/storage) to process images with machine learning models.

cloud computing teams include: 
- Satria Aryandhi Febrian Koto (C491D4KY0828)
- Azra Nadhira Aulia (C491D4KX1005)
  
## About API 
Backend-API is an API that has functions to manage and process data related to book bartering. When making this API we used [NodeJS](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) with several other dependencies, namely [firebase](https://console.firebase.google.com/u/0/), multer, and axios. 

This API consists of 5 main endpoints that have different functions including : 
1. Login & registration
2. Profile
3. Books
4. Like Book
5. Book barter system


## Pre-Requisite
* NodeJS v18.20.3
  
## How To Use 

### 1. Clone this repository

   ``` nodeJS
   git clone https://github.com/LitSwap/backend-api.git
   ```
### 2. Prepare the environment
   Before you can run the API, you need to prepare your environment. First you should create an    [.env] file to create a configuration file, which should look something like this :
   ```
   FIREBASE_API_KEY=
   FIREBASE_AUTH_DOMAIN=
   FIREBASE_PROJECT_ID=
   FIREBASE_STORAGE_BUCKET=
   FIREBASE_MESSAGING_SENDER_ID=
   FIREBASE_APP_ID=
   FIREBASE_MEASUREMENT_ID=
   FIREBASE_CLIENT_EMAIL=
   FIREBASE_PRIVATE_KEY=
   MODEL_URL=
   ```
### 3. Setting up the project platform on firebase firestore and google cloud storage
   To get the firebase configuration, you need to create a project in firebase. And get the configuration from the project settings and firebase admin sdk for file [serviceAccountKey.json]. And it also needs [bucketAccountKey.json] from google cloud storage to process the inputted image.
### 4. Set up the module and some dependencies that need to be downloaded. 
```
npm install
npm run start
```
This will install all the dependencies required and run the service.    


> You can try it by using postman on the collection and environment in this repository.
   
   
   


