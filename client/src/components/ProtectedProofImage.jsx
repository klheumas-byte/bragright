import { useEffect, useState } from "react";
import { fetchProtectedAsset } from "../services/api";
import SectionSkeleton from "./SectionSkeleton";

export default function ProtectedProofImage({ path, alt = "Match proof" }) {
  const [assetUrl, setAssetUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setAssetUrl("");
    setError("");
    fetchProtectedAsset(path)
      .then((blob) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setAssetUrl(objectUrl);
      })
      .catch((assetError) => {
        if (active) {
          setError(assetError?.message || "Could not load proof.");
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, attempt]);

  if (error) {
    return (
      <div className="match-proof-error" role="alert">
        <span className="match-card-meta">{error}</span>
        <button
          type="button"
          className="inline-action-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry proof
        </button>
      </div>
    );
  }
  if (!assetUrl) {
    return (
      <div className="match-proof-skeleton" aria-busy="true">
        <span className="sr-only" role="status">Loading match proof</span>
        <SectionSkeleton lines={2} compact />
      </div>
    );
  }

  return (
    <a className="match-proof-link" href={assetUrl} target="_blank" rel="noreferrer">
      <img className="match-proof-image" src={assetUrl} alt={alt} />
      <span className="inline-action-link">Open proof</span>
    </a>
  );
}
