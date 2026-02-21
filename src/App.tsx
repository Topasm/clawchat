import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './app/config/ThemeProvider';
import AppRouter from './router';

// TODO: Re-enable auth gate when login flow is needed
// import { useTheme } from './app/config/ThemeContext';
// import { useAuthStore } from './app/stores/useAuthStore';
// import LoginPage from './app/pages/LoginPage';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ThemeProvider>
  );
}
