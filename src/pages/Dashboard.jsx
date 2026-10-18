
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  LogOut,
  Plus,
  ShieldCheck,
  ExternalLink,
  MapPin,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { normalizeAdvertisement } from "../services/advertisements";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [ads, setAds] = useState([]);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!user?.id || !supabase) {
      setAds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [adResult, subscriptionResult] = await Promise.all([
        supabase
          .from("advRec")
          .select("*")
          .eq("company_id", user.id)
          .order("created_at", { ascending: false }),

        supabase
          .from("ad_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", user.id),
      ]);

      if (adResult.error) throw adResult.error;

      if (subscriptionResult.error) {
        throw subscriptionResult.error;
      }

      setAds((adResult.data ?? []).map(normalizeAdvertisement));
      setSubscriptionCount(subscriptionResult.count ?? 0);
    } catch (err) {
      setError(err.message || "Could not load dashboard records.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <main className="dashboard-page">
      <div className="container">
        <div className="dashboard-welcome">
          <div>
            <span className="section-kicker">COMPANY WORKSPACE</span>
            <h1>Welcome to your dashboard.</h1>
            <p>Manage your business presence on AdSphere.</p>
          </div>

          <button
            className="button button-light"
            onClick={handleSignOut}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>

        <div className="dashboard-account">
          <div className="dashboard-avatar">
            <Building2 />
          </div>
          <div>
            <h2>{user?.user_metadata?.company_name || "Your company"}</h2>
            <p>{user?.email}</p>
            <span className="status-chip">
              <ShieldCheck size={14} />
              Authenticated account
            </span>
          </div>
        </div>

        <div className="dashboard-stats">
          <div className="stat-card">
            <span>Advertisements</span>
            <strong>{loading ? "…" : ads.length}</strong>
            <small>Your records in advRec</small>
          </div>

          <div className="stat-card">
            <span>Subscriptions</span>
            <strong>{loading ? "…" : subscriptionCount}</strong>
            <small>Records in ad_subscriptions</small>
          </div>

          <div className="stat-card">
            <span>Plan & billing</span>
            <strong>Manual</strong>
            <small>Payment gateway not enabled</small>
          </div>
        </div>

        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2>Your advertisements</h2>
              <p>Create and manage your business listings.</p>
            </div>

            <button
              className="button button-gradient"
              onClick={() => navigate("/plans")}
            >
              <Plus size={18} />
              New advertisement
            </button>
          </div>

          {error && (
            <div className="form-error" role="alert">
              Could not load your records: {error}
            </div>
          )}

          {loading ? (
            <div className="dashboard-empty">
              <div className="page-loader">
                Loading your advertisements…
              </div>
            </div>
          ) : ads.length > 0 ? (
            <div className="dashboard-ad-list">
              {ads.map((ad) => (
                <article className="dashboard-ad-row" key={ad.id}>
                  <div className="dashboard-ad-thumb">
                    {ad.image_url ? (
                      <img
                        src={ad.image_url}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Building2 size={25} />
                    )}
                  </div>

                  <div className="dashboard-ad-copy">
                    <span className="dashboard-tier">
                      {ad.tier} · {ad.category}
                    </span>
                    <h3>{ad.name}</h3>
                    <p>{ad.description}</p>
                    <small>
                      <MapPin size={13} />
                      {ad.address || ad.location || "Location not supplied"}
                    </small>
                  </div>

                  <div className="dashboard-ad-actions">
                    <span className="dashboard-payment-status">
                      {ad.payment_status || "Status unavailable"}
                    </span>

                    {ad.website_url && (
                      <a
                        href={ad.website_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${ad.name} website`}
                      >
                        <ExternalLink size={17} />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <div className="empty-icon">
                <Building2 />
              </div>
              <h3>No advertisements yet</h3>
              <p>
                Choose T1 Featured Partner, T2 Local Favorites, or
                T3 Around the Corner to create your first listing.
              </p>
              <button
                className="button button-gradient"
                onClick={() => navigate("/plans")}
              >
                Choose a plan <ArrowUpRight size={16} />
              </button>
            </div>
          )}

          {!loading && !error && (
            <button
              className="button button-light"
              type="button"
              onClick={loadDashboard}
              style={{ marginTop: 16 }}
            >
              Refresh advertisements
            </button>
          )}
        </section>

        <section className="dashboard-panel plan-panel">
          <div>
            <CircleDollarSign size={24} />
            <h2>Plan & subscription</h2>
            <p>Review the placement options before you launch.</p>
          </div>

          <Link to="/plans" className="button button-dark">
            Explore plans <ArrowUpRight size={17} />
          </Link>
        </section>
      </div>
    </main>
  );
}
