import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, ShieldCheck, UserRound, LogIn, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

async function signInWithCredentials(email, password) {
  const csrfRes = await fetch("/api/auth/csrf");
  if (!csrfRes.ok) {
    throw new Error("Failed to initialize sign in");
  }

  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({
    email,
    password,
    csrfToken,
    callbackUrl: "/",
    json: "true",
  });

  const response = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false || data?.error) {
    if (data?.error === "ACCOUNT_ALREADY_ACTIVE") {
      throw new Error("This account is already signed in on another session. Please sign out first.");
    }

    throw new Error("Invalid email or password");
  }
}

export default function Landing() {
  const { toast } = useToast();
  const [authMode, setAuthMode] = useState("login");
  const [rememberMe, setRememberMe] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [resetRequestForm, setResetRequestForm] = useState({ email: "" });
  const [resetConfirmForm, setResetConfirmForm] = useState({ password: "", confirmPassword: "" });
  const [resetToken, setResetToken] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRequestingReset, setIsRequestingReset] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setResetToken(token);
      setAuthMode("reset-confirm");
    }
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setIsLoggingIn(true);
    try {
      await signInWithCredentials(
        String(loginForm.email || "").trim().toLowerCase(),
        loginForm.password
      );
      window.location.href = "/";
    } catch (error) {
      toast({
        title: "Unable to sign in",
        description: error.message || "Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setIsRegistering(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: registerForm.name,
          email: registerForm.email,
          password: registerForm.password,
          role: registerForm.role,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to register");
      }

      toast({
        title: "Registration submitted",
        description: "Your account is pending super admin approval before you can sign in.",
      });
      setRegisterForm((prev) => ({ ...prev, password: "" }));
      setLoginForm((prev) => ({ ...prev, email: String(registerForm.email || "").trim().toLowerCase() }));
    } catch (error) {
      toast({
        title: "Registration failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleResetRequest = async (event) => {
    event.preventDefault();
    setIsRequestingReset(true);
    setResetLink("");
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetRequestForm.email }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to prepare reset link");
      }

      if (data?.resetLink) {
        setResetLink(data.resetLink);
      }

      toast({
        title: "Password reset",
        description: data?.message || "If the account exists, a reset link has been prepared.",
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRequestingReset(false);
    }
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (resetConfirmForm.password !== resetConfirmForm.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }

    setIsResettingPassword(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          password: resetConfirmForm.password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to reset password");
      }

      toast({
        title: "Password updated",
        description: data?.message || "You can now sign in.",
      });
      window.history.replaceState({}, "", "/landing");
      setResetToken("");
      setResetConfirmForm({ password: "", confirmPassword: "" });
      setAuthMode("login");
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error.message || "Please request a new reset link.",
        variant: "destructive",
      });
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-600 p-4 md:p-7">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1080px] overflow-hidden rounded-xl bg-white shadow-[0_25px_60px_rgba(28,28,45,0.35)] md:min-h-[640px]">
        <section className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-500 p-12 text-white md:block">
          <div className="absolute -left-24 -top-20 h-56 w-56 rounded-full bg-white/20 blur-sm" />
          <div className="absolute left-8 top-20 h-24 w-24 rounded-full bg-cyan-300/40" />
          <div className="absolute bottom-40 right-10 h-28 w-28 rounded-full bg-white/15" />
          <div className="absolute -bottom-20 -left-8 h-52 w-[120%] rounded-[50%] bg-white/95" />
          <div className="absolute right-10 top-28 h-44 w-72 rounded-[45%] bg-violet-400/35 blur-[1px]" />
          <div className="absolute left-16 bottom-40 h-24 w-24 rounded-full bg-blue-700/45" />

          <div className="relative z-10 mt-40 space-y-4">
            <h1 className="text-5xl font-medium leading-tight tracking-tight">Welcome Page</h1>
            <p className="max-w-xs text-sm tracking-wide text-white/85">
              Sign in to your account and manage payroll, attendance, and employee workflows.
            </p>
          </div>

          <p className="absolute bottom-10 left-12 text-xs tracking-[0.35em] text-slate-800/70">
            WWW.PAYROLLPH.LOCAL
          </p>
        </section>

        <section className="w-full p-6 md:w-1/2 md:px-14 md:py-16">
          <div className="mx-auto w-full max-w-[360px]">
            <p className="text-[22px] leading-none text-slate-700">Hello !</p>
            <p className="mt-1 text-[30px] font-semibold leading-none text-violet-600">{greeting}</p>

            {authMode.startsWith("reset") ? (
              <button
                type="button"
                onClick={() => {
                  window.history.replaceState({}, "", "/landing");
                  setResetToken("");
                  setAuthMode("login");
                }}
                className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-violet-600"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </button>
            ) : (
              <div className="mt-10 grid grid-cols-2 rounded-md bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`rounded px-3 py-2 text-sm font-medium transition ${
                    authMode === "login" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <LogIn className="h-4 w-4" />
                    Login
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className={`rounded px-3 py-2 text-sm font-medium transition ${
                    authMode === "register" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <UserPlus className="h-4 w-4" />
                    Register
                  </span>
                </button>
              </div>
            )}

            {authMode === "login" ? (
              <form onSubmit={handleLogin} className="mt-8 space-y-5">
                <p className="text-base font-medium text-foreground">Login Your Account</p>
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-[11px] tracking-[0.28em] text-slate-400">
                    EMAIL ADDRESS
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    PASSWORD
                  </Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-3 w-3 rounded border-slate-300"
                    />
                    <span>Remember</span>
                  </label>
                  <button
                    type="button"
                    className="text-slate-500 transition hover:text-violet-600"
                    onClick={() => {
                      setResetRequestForm({ email: loginForm.email });
                      setAuthMode("reset-request");
                    }}
                  >
                    Forgot Password ?
                  </button>
                </div>
                <Button
                  type="submit"
                  disabled={isLoggingIn}
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.3em] text-white hover:opacity-95"
                >
                  {isLoggingIn ? "SIGNING IN..." : "SUBMIT"}
                </Button>
                <p className="pt-1 text-center text-[11px] text-slate-500">
                  Need an account?{" "}
                  <button
                    type="button"
                    onClick={() => setAuthMode("register")}
                    className="font-medium text-violet-600 hover:underline"
                  >
                    Create account
                  </button>
                </p>
              </form>
            ) : authMode === "register" ? (
              <form onSubmit={handleRegister} className="mt-8 space-y-4">
                <p className="text-base font-medium text-foreground">Create Account</p>
                <div className="space-y-2">
                  <Label htmlFor="register-name" className="text-[11px] tracking-[0.28em] text-slate-400">
                    FULL NAME
                  </Label>
                  <Input
                    id="register-name"
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email" className="text-[11px] tracking-[0.28em] text-slate-400">
                    EMAIL ADDRESS
                  </Label>
                  <Input
                    id="register-email"
                    type="email"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    PASSWORD
                  </Label>
                  <Input
                    id="register-password"
                    type="password"
                    minLength={8}
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] tracking-[0.28em] text-slate-400">ROLE</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={registerForm.role === "admin" ? "default" : "outline"}
                      className="justify-start gap-2"
                      onClick={() => setRegisterForm((p) => ({ ...p, role: "admin" }))}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Admin
                    </Button>
                    <Button
                      type="button"
                      variant={registerForm.role === "user" ? "default" : "outline"}
                      className="justify-start gap-2"
                      onClick={() => setRegisterForm((p) => ({ ...p, role: "user" }))}
                    >
                      <UserRound className="w-4 h-4" />
                      HR Officer
                    </Button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.24em] text-white hover:opacity-95"
                  disabled={isRegistering}
                >
                  {isRegistering ? "CREATING..." : "CREATE ACCOUNT"}
                </Button>
                <p className="pt-1 text-center text-[11px] text-slate-500">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setAuthMode("login")}
                    className="font-medium text-violet-600 hover:underline"
                  >
                    Login
                  </button>
                </p>
              </form>
            ) : authMode === "reset-request" ? (
              <form onSubmit={handleResetRequest} className="mt-8 space-y-5">
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-base font-medium text-foreground">
                    <KeyRound className="h-4 w-4 text-violet-600" />
                    Recover Password
                  </p>
                  <p className="text-sm text-slate-500">
                    Enter your account email to prepare a secure reset link.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-email" className="text-[11px] tracking-[0.28em] text-slate-400">
                    EMAIL ADDRESS
                  </Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={resetRequestForm.email}
                    onChange={(e) => setResetRequestForm((p) => ({ ...p, email: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                {resetLink ? (
                  <div className="break-words rounded-md border border-violet-100 bg-violet-50 p-3 text-xs text-slate-600">
                    <p className="mb-1 font-medium text-violet-700">Reset link</p>
                    <a href={resetLink} className="text-violet-700 underline">
                      {resetLink}
                    </a>
                  </div>
                ) : null}
                <Button
                  type="submit"
                  disabled={isRequestingReset}
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.2em] text-white hover:opacity-95"
                >
                  {isRequestingReset ? "PREPARING..." : "SEND RESET LINK"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handlePasswordReset} className="mt-8 space-y-5">
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-base font-medium text-foreground">
                    <KeyRound className="h-4 w-4 text-violet-600" />
                    Set New Password
                  </p>
                  <p className="text-sm text-slate-500">
                    Choose a new password with at least 8 characters.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    NEW PASSWORD
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    minLength={8}
                    value={resetConfirmForm.password}
                    onChange={(e) => setResetConfirmForm((p) => ({ ...p, password: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    CONFIRM PASSWORD
                  </Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    minLength={8}
                    value={resetConfirmForm.confirmPassword}
                    onChange={(e) => setResetConfirmForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isResettingPassword || !resetToken}
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.2em] text-white hover:opacity-95"
                >
                  {isResettingPassword ? "UPDATING..." : "UPDATE PASSWORD"}
                </Button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
