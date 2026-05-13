import { Link, useLocation } from 'react-router-dom';
import { PartnerIcon, HomeIcon, BoxIcon, ShoppingCartIcon } from './Icons'; // Kumpulkan icon di satu file
import '../css/Sidebar.css';

export default function Sidebar() {
  const location = useLocation();

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: <HomeIcon /> },
    { path: '/business-partner', label: 'Business Partner', icon: <PartnerIcon /> },
    { path: '/product', label: 'Products', icon: <BoxIcon /> },
    { path: '/sales-order', label: 'Sales Order', icon: <ShoppingCartIcon /> },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">iD</div>
        <span>iDempiere <em>POS</em></span>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <Link 
            key={item.path}
            to={item.path} 
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
