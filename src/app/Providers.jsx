// src/app/Providers.jsx
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { BusinessProvider } from '../business/BusinessContext.jsx';

export function Providers({ children }) {
  return (
    <HashRouter>
      <AuthProvider>
        <BusinessProvider>
          {children}
        </BusinessProvider>
      </AuthProvider>
    </HashRouter>
  );
}
