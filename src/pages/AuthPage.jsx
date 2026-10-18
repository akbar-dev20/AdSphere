
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, RadioTower } from "lucide-react";
import { registerCompany, signInCompany } from "../services/companies";

export default function AuthPage({ mode = "login" }) {
  const registering = mode === "register";
  const { user, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const location = useLocation();

  // Preserve the requested page, including ?plan=T1/T2/T3.
  const destination = location.state?.from || "/dashboard";

  useEffect(() => {
    if (!authLoading && user) {
      navigate(destination, { replace: true });
    }
  }, [user, authLoading, navigate, destination]);

  if (authLoading) {
    return <div className="page-loader">Checking your account…</div>;
  }

  if (user) {
    return <div className="page-loader">Opening your workspace…</div>;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (registering) {
        const result = await registerCompany({
          name,
          email,
          password,
        });

        if (result.session) {
          navigate(destination, { replace: true });
        } else {
          setMessage(
            "Account created. Check your email to confirm your account, then sign in."
          );
        }
      } else {
        await signInCompany({ email, password });
        navigate(destination, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link to="/" className="back-link">
          <ArrowLeft size={17} />
          Back to discover
        </Link>

        <div className="auth-brand">
          <span className="brand-mark">
            <RadioTower />
          </span>
          <span>AdSphere</span>
        </div>

        <span className="section-kicker">
          {registering ? "JOIN THE NEIGHBORHOOD" : "WELCOME BACK"}
        </span>

        <h1>
          {registering
            ? "Put your business on the map."
            : "Good to see you again."}
        </h1>

        <p>
          {registering
            ? "Create an account to start your AdSphere journey."
            : "Sign in to manage your business and advertisements."}
        </p>

        <form className="form-stack" onSubmit={submit}>
          {registering && (
            <label>
              Business name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your business name"
                maxLength={120}
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete={registering ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          {message && (
            <div className="form-success" role="status">
              {message}
            </div>
          )}

          <button
            className="button button-gradient button-full"
            disabled={busy}
          >
            {busy
              ? "Please wait…"
              : registering
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {registering
            ? "Already have an account?"
            : "New to AdSphere?"}{" "}
          <Link to={registering ? "/login" : "/register"}>
            {registering ? "Sign in" : "Create a company account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
