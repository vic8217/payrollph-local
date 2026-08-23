import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";

export default function Maintenance() {
  const { user, logout } = useAuth();

  return (
    <main className="min-h-screen bg-slate-50 px-6 flex items-center justify-center">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
          P
        </div>
        <p className="text-sm font-semibold tracking-wide text-primary">PayrollPH</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">PayrollPH is temporarily unavailable</h1>
        <p className="mt-4 text-slate-600">
          The system is currently undergoing maintenance. Please try again later.
        </p>
        {user && (
          <Button className="mt-8" variant="outline" onClick={() => logout("/maintenance")}>
            Sign out
          </Button>
        )}
      </section>
    </main>
  );
}
