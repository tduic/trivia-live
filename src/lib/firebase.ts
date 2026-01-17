import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAmZGJMEcG5Nh2DESJWycbw0KSGGU4BJkM",
  authDomain: "feud-live.firebaseapp.com",
  projectId: "feud-live",
  storageBucket: "feud-live.firebasestorage.app",
  messagingSenderId: "899976762657",
  appId: "1:899976762657:web:2799bc4bb68e3a04c09a60",
  measurementId: "G-5T3ZMLK6DH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getFirestore(app);
