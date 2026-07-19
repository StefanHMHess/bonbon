import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: String(error?.message || "Unbekannter Fehler"),
    };
  }

  componentDidCatch(error, info) {
    console.error("Root render crash:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "24px", maxWidth: "720px", margin: "0 auto", color: "#10243e" }}>
          <h1 style={{ marginBottom: "12px" }}>BonBox konnte nicht geladen werden</h1>
          <p style={{ marginBottom: "10px" }}>
            Die App wurde vor einem Absturz geschützt. Bitte Seite neu laden.
          </p>
          <p style={{ marginBottom: "16px", fontSize: "0.92rem", opacity: 0.9 }}>
            Fehler: {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: "none",
              borderRadius: "999px",
              padding: "10px 16px",
              background: "#18b6a3",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Neu laden
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
