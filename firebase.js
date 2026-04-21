import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, push } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyD3wlPK4G8DaX-T4pnkObKxAuUXFDpCg74",
    authDomain: "the-game-of-life-69044.firebaseapp.com",
    projectId: "the-game-of-life-69044",
    storageBucket: "the-game-of-life-69044.firebasestorage.app",
    messagingSenderId: "846133505087",
    appId: "1:846133505087:web:7718fe87d8bec7ecca9c8a",
    measurementId: "G-N5BGD0C2NV",
    databaseURL: "https://the-game-of-life-69044-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, onValue, update, get, push };
