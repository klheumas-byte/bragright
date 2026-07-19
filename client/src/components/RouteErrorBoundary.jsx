import React from "react";
import { Button } from "./ui";

export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error("BragRight route render error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="route-error-state" role="alert">
          <p className="section-label">Route unavailable</p>
          <h2>This screen could not be opened.</h2>
          <p>Your navigation and the rest of the app are still available.</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </section>
      );
    }

    return this.props.children;
  }
}
