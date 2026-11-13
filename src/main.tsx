import ReactDOM from "react-dom/client";
import App from "./App";

// No React.StrictMode: its double-invoked effects would start two Matrix clients.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
