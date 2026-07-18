import React from "react";
import { Link } from "react-router-dom";
import { Button } from "./ui";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "Something went wrong while rendering this page.",
    };
  }

  componentDidCatch(error, errorInfo) {
    // Keep a console trail for production debugging without crashing the whole app.
    console.error("BragRight render error", error, errorInfo);
  }

  handleReload = () => {
    window.location.assign(window.location.pathname + window.location.search + window.location.hash);
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="route-loading-shell">
          <div className="route-loading-card">
            <p className="route-loading-label">Something went wrong</p>
            <h1 className="route-loading-title">This page hit an unexpected error.</h1>
            <p className="panel-subtitle">{this.state.errorMessage}</p>
            <div className="admin-resolution-actions">
              <Button className="auth-button" onClick={this.handleReload}>
                Reload page
              </Button>
              <Button as={Link} variant="secondary" className="inline-action-button" to="/login">
                Go to login
              </Button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
