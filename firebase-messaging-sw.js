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

// Handle background messages (FCM shows the notification automatically — don't call showNotification here)
messaging.onBackgroundMessage(function (payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
});

// Handle notification action button clicks
self.addEventListener('notificationclick', function (event) {
  event.notification.close(); // Always close the notification first

  const action = event.action;
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  // Dismiss / close actions: close only, no navigation
  if (action === 'close' || action === 'dismiss') return;

  // View action or clicking the notification body: open the URL
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // If the URL is already open, focus it
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url === url && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
