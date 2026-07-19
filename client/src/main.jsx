import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { LoadingProvider } from "./context/LoadingContext";
import { PlayerDirectoryProvider } from "./context/PlayerDirectoryContext";
import { ThemeProvider } from "./context/ThemeContext";
import "./styles/tokens.css";
import "./styles/design-system.css";
import "./index.css";
import "./styles/premium-theme.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <AppErrorBoundary>
          <LoadingProvider>
            <AuthProvider>
              <PlayerDirectoryProvider>
                <App />
              </PlayerDirectoryProvider>
            </AuthProvider>
          </LoadingProvider>
        </AppErrorBoundary>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>
);
