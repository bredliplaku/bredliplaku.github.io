importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in your firebaseConfig
const firebaseApp = firebase.initializeApp({
  apiKey: "AIzaSyBsaZloy5J41I-hj9X4Z6tgS8cTcWAFqNg",
  authDomain: "attendance-logger-452915.firebaseapp.com",
  projectId: "attendance-logger-452915",
  storageBucket: "attendance-logger-452915.firebasestorage.app",
  messagingSenderId: "740588046540",
  appId: "1:740588046540:web:1da835a0d7dd68cb199a69",
  measurementId: "G-PMGY5GD2FQ"
});

const messaging = firebase.messaging();

// Optional: Handle background messages
messaging.onBackgroundMessage(function (payload) {
  console.log('[firebase-messaging-sw.js] Received background message natively by FCM ', payload);
  // FCM automatically displays a native notification when the app is in the background 
  // because the payload contains a 'notification' object.
  // We do not need to call self.registration.showNotification here, or it will duplicate!
});
