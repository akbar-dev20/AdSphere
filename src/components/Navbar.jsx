import { Link, NavLink } from "react-router-dom";
import { Menu, RadioTower, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();
  return (
    <header className="site-header">
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark"><RadioTower size={22} /></span>
          <span><strong>AdSphere</strong><small>Discover something great</small></span>
        </Link>
        <div className={`nav-links ${open ? "is-open" : ""}`}>
          <NavLink to="/" onClick={() => setOpen(false)}>Discover</NavLink>
          <NavLink to="/plans" onClick={() => setOpen(false)}>Plans</NavLink>
          {user ? <NavLink to="/dashboard" onClick={() => setOpen(false)}>Dashboard</NavLink> : null}
          {user ? <button className="nav-text-button" onClick={async () => { await signOut(); setOpen(false); }}>Sign out</button> : <Link className="nav-login" to="/login" onClick={() => setOpen(false)}>Company login</Link>}
          <Link className="button button-small button-gradient" to={user ? "/dashboard" : "/register"} onClick={() => setOpen(false)}>
            {user ? "Manage your ads" : "What advertise your service?"}
          </Link>
        </div>
        <button className="menu-toggle" aria-label="Toggle menu" onClick={() => setOpen(v => !v)}>{open ? <X /> : <Menu />}</button>
      </div>
    </header>
  );
}
