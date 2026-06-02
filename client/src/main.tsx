import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeWithConsent } from "./lib/cookieConsent";
import "./index.css";

// Inicializar scripts de analítica si hay consentimiento previo
initializeWithConsent();

createRoot(document.getElementById("root")!).render(<App />);
