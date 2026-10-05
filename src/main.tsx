import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

window.Telegram?.WebApp.ready();
window.Telegram?.WebApp.expand();
window.Telegram?.WebApp.setHeaderColor?.('#09090b');
window.Telegram?.WebApp.setBackgroundColor?.('#09090b');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
