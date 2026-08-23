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
    if (data?.error === "ACCESS_SCHEDULE_BLOCKED") {
      throw new Error("Your account is outside its allowed access schedule. Please contact the super admin.");
    }
    if (data?.error === "MAINTENANCE_MODE") {
      const error = new Error("MAINTENANCE_MODE");
      error.code = "MAINTENANCE_MODE";
      throw error;
    }

    throw new Error("Invalid email or password");
  }
}

export default function Landing() {
  const { toast } = useToast();
  const [authMode, setAuthMode] = useState("login");
  const [rememberMe, setRememberMe] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [resetRequestForm, setResetRequestForm] = useState({
    email: "",
    passcode: "",
    recoveryKey: "",
    password: "",
    confirmPassword: "",
  });
  const [resetConfirmForm, setResetConfirmForm] = useState({ password: "", confirmPassword: "" });
  const [resetToken, setResetToken] = useState("");
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
    superAdminRecoveryKey: "",
  });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isUsingPasscode, setIsUsingPasscode] = useState(false);
  const [isUsingRecoveryKey, setIsUsingRecoveryKey] = useState(false);
  const [showSuperAdminRecovery, setShowSuperAdminRecovery] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  // Keep public account-creation/recovery controls hidden until the non-sensitive
  // status endpoint explicitly says maintenance is off.
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(null);
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

  useEffect(() => {
    fetch("/api/auth/maintenance-status")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setIsMaintenanceMode(data?.maintenance === true))
      .catch(() => setIsMaintenanceMode(true));
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
      if (error.code === "MAINTENANCE_MODE" || error.message === "MAINTENANCE_MODE") {
        window.location.href = "/maintenance";
        return;
      }
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
          superAdminRecoveryKey: registerForm.superAdminRecoveryKey,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to register");
      }

      toast({
        title: registerForm.role === "super_admin" ? "Super admin registered" : "Registration submitted",
        description:
          registerForm.role === "super_admin"
            ? "You can now sign in with this super admin account."
            : "Your account is pending super admin approval before you can sign in.",
      });
      setRegisterForm((prev) => ({ ...prev, password: "", superAdminRecoveryKey: "" }));
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

  const handlePasscodeReset = async (event) => {
    event.preventDefault();
    const rawPasscode = String(resetRequestForm.passcode || "");
    const normalizedPasscode = rawPasscode.replace(/[^a-z0-9]/gi, "");
    const looksLikeRecoveryKey =
      /[+/=]/.test(rawPasscode) || normalizedPasscode.length > 12;

    if (looksLikeRecoveryKey) {
      setResetRequestForm((prev) => ({
        ...prev,
        passcode: "",
        recoveryKey: prev.passcode,
      }));
      setShowSuperAdminRecovery(true);
      toast({
        title: "Use recovery key mode",
        description: "That looks like a private recovery key. Please submit it in the recovery key form.",
      });
      return;
    }

    if (resetRequestForm.password !== resetRequestForm.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }

    setIsUsingPasscode(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetRequestForm.email,
          passcode: resetRequestForm.passcode,
          password: resetRequestForm.password,
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
      setResetRequestForm({ email: "", passcode: "", recoveryKey: "", password: "", confirmPassword: "" });
      setAuthMode("login");
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error.message || "Ask the super admin for a new passcode.",
        variant: "destructive",
      });
    } finally {
      setIsUsingPasscode(false);
    }
  };

  const handleSuperAdminRecovery = async (event) => {
    event.preventDefault();
    if (resetRequestForm.password !== resetRequestForm.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }

    setIsUsingRecoveryKey(true);
    try {
      const response = await fetch("/api/auth/super-admin-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetRequestForm.email,
          recoveryKey: resetRequestForm.recoveryKey,
          password: resetRequestForm.password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to recover super admin account");
      }

      toast({
        title: "Super admin recovered",
        description: data?.message || "You can now sign in.",
      });
      setResetRequestForm({ email: "", passcode: "", recoveryKey: "", password: "", confirmPassword: "" });
      setShowSuperAdminRecovery(false);
      setAuthMode("login");
    } catch (error) {
      toast({
        title: "Recovery failed",
        description: error.message || "Check the private recovery key and try again.",
        variant: "destructive",
      });
    } finally {
      setIsUsingRecoveryKey(false);
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
    <div className="landing-auth-page min-h-screen bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-600">
      <div className="landing-auth-shell mx-auto flex overflow-hidden rounded-xl bg-white shadow-[0_25px_60px_rgba(28,28,45,0.35)]">
        <section className="landing-auth-hero relative overflow-hidden bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-500 text-white">
          <div className="absolute -left-24 -top-20 h-56 w-56 rounded-full bg-white/20 blur-sm" />
          <div className="absolute left-8 top-20 h-24 w-24 rounded-full bg-cyan-300/40" />
          <div className="absolute bottom-40 right-10 h-28 w-28 rounded-full bg-white/15" />
          <div className="landing-auth-wave absolute -left-8 w-[120%] rounded-[50%] bg-white/95" />
          <div className="absolute right-10 top-28 h-44 w-72 rounded-[45%] bg-violet-400/35 blur-[1px]" />
          <div className="absolute left-16 bottom-40 h-24 w-24 rounded-full bg-blue-700/45" />

          <div className="landing-auth-hero-copy relative z-10 space-y-4">
            <h1 className="text-4xl font-medium leading-tight tracking-tight md:text-5xl">Welcome Page</h1>
            <p className="max-w-md text-sm tracking-wide text-white/85 xl:text-base">
              Sign in to your account and manage payroll, attendance, and employee workflows.
            </p>
          </div>

          <p className="landing-auth-url absolute text-xs tracking-[0.35em] text-slate-800/70 xl:left-16 2xl:left-20">
            WWW.PAYROLLPH.LOCAL
          </p>
        </section>

        <section className="landing-auth-form-panel flex items-center">
          <div className="landing-auth-form mx-auto w-full">
            <p className="text-[22px] leading-none text-slate-700 xl:text-2xl">Hello !</p>
            <p className="mt-1 text-[30px] font-semibold leading-none text-violet-600 xl:text-4xl">{greeting}</p>

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
              <div className={`landing-auth-tabs mt-10 grid ${isMaintenanceMode === false ? "grid-cols-2" : "grid-cols-1"} rounded-md bg-muted p-1`}>
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
                {isMaintenanceMode === false && <button
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
                </button>}
              </div>
            )}

            {authMode === "login" ? (
              <form onSubmit={handleLogin} className="landing-auth-fields mt-8 space-y-5 xl:space-y-6">
                <p className="text-base font-medium text-foreground xl:text-lg">Login Your Account</p>
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
                  {isMaintenanceMode === false && <button
                    type="button"
                    className="text-slate-500 transition hover:text-violet-600"
                    onClick={() => {
                      setResetRequestForm((prev) => ({ ...prev, email: loginForm.email }));
                      setAuthMode("reset-request");
                    }}
                  >
                    Forgot Password ?
                  </button>}
                </div>
                <Button
                  type="submit"
                  disabled={isLoggingIn}
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.3em] text-white hover:opacity-95"
                >
                  {isLoggingIn ? "SIGNING IN..." : "SUBMIT"}
                </Button>
                {isMaintenanceMode === false && <p className="pt-1 text-center text-[11px] text-slate-500">
                  Need an account?{" "}
                  <button
                    type="button"
                    onClick={() => setAuthMode("register")}
                    className="font-medium text-violet-600 hover:underline"
                  >
                    Create account
                  </button>
                </p>}
              </form>
            ) : authMode === "register" ? (
              <form onSubmit={handleRegister} className="landing-auth-fields mt-8 space-y-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant={registerForm.role === "super_admin" ? "default" : "outline"}
                      className="justify-start gap-2"
                      onClick={() => setRegisterForm((p) => ({ ...p, role: "super_admin" }))}
                    >
                      <KeyRound className="w-4 h-4" />
                      Super Admin
                    </Button>
                    <Button
                      type="button"
                      variant={registerForm.role === "admin" ? "default" : "outline"}
                      className="justify-start gap-2"
                      onClick={() => setRegisterForm((p) => ({ ...p, role: "admin" }))}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Management
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
                {registerForm.role === "super_admin" && (
                  <div className="space-y-2">
                    <Label htmlFor="register-super-admin-key" className="text-[11px] tracking-[0.28em] text-slate-400">
                      SUPER ADMIN RECOVERY KEY
                    </Label>
                    <Input
                      id="register-super-admin-key"
                      type="password"
                      value={registerForm.superAdminRecoveryKey}
                      onChange={(e) => setRegisterForm((p) => ({ ...p, superAdminRecoveryKey: e.target.value }))}
                      className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                      required
                    />
                    <p className="text-xs text-slate-500">Required only when creating a super admin account.</p>
                  </div>
                )}
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
              <form onSubmit={showSuperAdminRecovery ? handleSuperAdminRecovery : handlePasscodeReset} className="landing-auth-fields mt-8 space-y-4">
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-base font-medium text-foreground">
                    <KeyRound className="h-4 w-4 text-violet-600" />
                    {showSuperAdminRecovery ? "Super Admin Recovery" : "Recover Password"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {showSuperAdminRecovery
                      ? "Enter the super admin email, private recovery key, and new password."
                      : "Enter your email, the passcode from the super admin, and your new password."}
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
                {showSuperAdminRecovery ? (
                  <div className="space-y-2">
                    <Label htmlFor="super-admin-recovery-key" className="text-[11px] tracking-[0.28em] text-slate-400">
                      PRIVATE RECOVERY KEY
                    </Label>
                    <Input
                      id="super-admin-recovery-key"
                      type="password"
                      value={resetRequestForm.recoveryKey}
                      onChange={(e) => setResetRequestForm((p) => ({ ...p, recoveryKey: e.target.value }))}
                      className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                      required
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="reset-passcode" className="text-[11px] tracking-[0.28em] text-slate-400">
                      RESET PASSCODE
                    </Label>
                    <Input
                      id="reset-passcode"
                      placeholder="ABCD-1234"
                      value={resetRequestForm.passcode}
                      onChange={(e) => setResetRequestForm((p) => ({ ...p, passcode: e.target.value }))}
                      className="rounded-none border-0 border-b border-slate-300 px-0 uppercase tracking-[0.18em] focus-visible:ring-0 focus-visible:border-violet-500"
                      required
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="reset-new-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    NEW PASSWORD
                  </Label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    minLength={8}
                    value={resetRequestForm.password}
                    onChange={(e) => setResetRequestForm((p) => ({ ...p, password: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm-password" className="text-[11px] tracking-[0.28em] text-slate-400">
                    CONFIRM PASSWORD
                  </Label>
                  <Input
                    id="reset-confirm-password"
                    type="password"
                    minLength={8}
                    value={resetRequestForm.confirmPassword}
                    onChange={(e) => setResetRequestForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    className="rounded-none border-0 border-b border-slate-300 px-0 focus-visible:ring-0 focus-visible:border-violet-500"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isUsingPasscode || isUsingRecoveryKey}
                  className="h-10 w-full rounded-none bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500 text-[13px] font-semibold tracking-[0.2em] text-white hover:opacity-95"
                >
                  {isUsingPasscode || isUsingRecoveryKey ? "UPDATING..." : "UPDATE PASSWORD"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSuperAdminRecovery((value) => !value);
                    setResetRequestForm((prev) => ({ ...prev, passcode: "", recoveryKey: "" }));
                  }}
                  className="block w-full text-center text-[11px] font-medium text-slate-500 transition hover:text-violet-600"
                >
                  {showSuperAdminRecovery ? "Use reset passcode instead" : "Use super admin recovery key"}
                </button>
              </form>
            ) : (
              <form onSubmit={handlePasswordReset} className="landing-auth-fields mt-8 space-y-5">
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
