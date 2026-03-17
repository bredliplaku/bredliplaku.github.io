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
  event.notification.close();

  const action = event.action;

  // FCM is wildly inconsistent with where it puts data depending on the OS and browser.
  // We agressive-search for the default URL in all known locations.
  let fcmData = {};
  if (event.notification.data) {
    if (event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.data) {
      fcmData = event.notification.data.FCM_MSG.data;
    } else {
      fcmData = event.notification.data;
    }
  }

  // 1. Try FCM_MSG's explicit fcmOptions.link (most reliable for body clicks)
  let defaultUrl = '/';
  if (event.notification.data && event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.notification && event.notification.data.FCM_MSG.notification.fcmOptions) {
    defaultUrl = event.notification.data.FCM_MSG.notification.fcmOptions.link || defaultUrl;
  }
  // 2. Try click_action fallback
  if (defaultUrl === '/' && event.notification.click_action) defaultUrl = event.notification.click_action;
  // 3. Try our custom injected data fields
  if (defaultUrl === '/') defaultUrl = fcmData.url || fcmData.customUrl || fcmData.click_action || '/';

  // Parse stored action URL map
  let actionUrls = {};

  if (fcmData.actionUrls) {
    try { actionUrls = JSON.parse(fcmData.actionUrls); }
    catch (e) { console.error('Error parsing action URLs', e); }
  }

  // Resolve destination
  let target = actionUrls[action];

  if (target === 'close' || target === 'dismiss') return;
  if (!target || !target.startsWith('http')) target = defaultUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        if (clientList[i].url === target && 'focus' in clientList[i]) return clientList[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
