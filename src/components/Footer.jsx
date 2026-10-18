import { Link } from "react-router-dom";
export default function Footer() {
  return <footer className="site-footer"><div className="container footer-inner"><Link className="footer-brand" to="/">AdSphere</Link><span>Discover local businesses, offers and experiences.</span><span>© {new Date().getFullYear()} AdSphere</span></div></footer>;
}
