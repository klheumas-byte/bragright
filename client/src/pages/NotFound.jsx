import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
        404
      </p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-3 text-slate-600">
        The page you requested does not exist.
      </p>
      <Link
        className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        to="/"
      >
        Return home
      </Link>
    </main>
  );
}
