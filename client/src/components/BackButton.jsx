import { useLocation, useNavigate } from "react-router-dom";

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const fallbackPath = location.pathname.startsWith("/admin") ? "/admin/dashboard" : "/dashboard";

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(fallbackPath);
  }

  return (
    <button type="button" className="inline-action-button dashboard-back-button" onClick={handleBack}>
      Back
    </button>
  );
}
