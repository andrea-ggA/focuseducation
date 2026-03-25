import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-6xl font-extrabold text-primary">404</h1>
        <p className="mb-2 text-2xl font-bold text-foreground">Pagina non trovata</p>
        <p className="mb-6 text-muted-foreground">La pagina che cerchi non esiste o è stata spostata.</p>
        <a href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Torna alla Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
