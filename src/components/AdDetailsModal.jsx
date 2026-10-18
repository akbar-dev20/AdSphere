import { useEffect } from "react";
import { ArrowUpRight, MapPin, X } from "lucide-react";

export default function AdDetailsModal({ ad, onClose }) {
  useEffect(() => {
    if (!ad) return undefined;
    const handleKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", handleKey); document.body.style.overflow = ""; };
  }, [ad, onClose]);
  if (!ad) return null;
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="ad-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button className="modal-close" aria-label="Close details" onClick={onClose}><X size={20}/></button>
      {ad.image_url && <img className="modal-image" src={ad.image_url} alt="" onError={e => { e.currentTarget.style.display = "none"; }}/>}
      <div className="modal-content"><span className="eyebrow">{ad.category} {ad.subcategory ? `· ${ad.subcategory}` : ""}</span><h2 id="modal-title">{ad.name}</h2><p>{ad.description || "Discover something great around you."}</p><span className="modal-location"><MapPin size={17}/>{ad.location || "Location not provided"}</span>
      <div className="card-actions">{ad.website_url ? <a className="button button-gradient" href={ad.website_url} target="_blank" rel="noreferrer">Visit website <ArrowUpRight size={18}/></a> : <span className="muted">Website not provided</span>}<button className="button button-light" onClick={onClose}>Close</button></div></div>
    </section>
  </div>;
}
