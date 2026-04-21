import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp, Activity, Home, LogOut, Menu, Palette, Settings, Users, UserCog, X, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import BrandMark from './BrandMark';
import UserAvatar from './UserAvatar';

export default function Layout({ children }) {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const role = user?.role;
  const canUseAdminPages = ['superadmin', 'admin', 'admin_readonly'].includes(role);
  const isSuperAdmin = role === 'superadmin';

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 320);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinkClass = (path) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    location.pathname === path
      ? 'bg-accent/20 text-dark'
      : 'text-gray-500 hover:text-dark hover:bg-gray-50'
  }`;

  const mobileNavLinkClass = (path) => `flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
    location.pathname === path
      ? 'bg-accent/20 text-dark'
      : 'text-gray-600 hover:text-dark hover:bg-gray-50'
  }`;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <nav className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm shadow-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-3 gap-4">
            <Link to="/" className="flex items-center gap-3 shrink-0">
              <BrandMark />
              <span className="font-bold text-lg text-dark">Frontdoor</span>
            </Link>

            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 transition-colors hover:bg-gray-50 hover:text-dark"
                aria-label="Apri menu"
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

            <div className="hidden md:flex items-center gap-2 min-w-0">
              <Link to="/" className={navLinkClass('/')}>
                <Home className="w-4 h-4" />
                Home
              </Link>

              {canUseAdminPages && (
                <>
                  <Link to="/admin" className={navLinkClass('/admin')}>
                    <Settings className="w-4 h-4" />
                    App
                  </Link>
                  <Link to="/admin/groups" className={navLinkClass('/admin/groups')}>
                    <Users className="w-4 h-4" />
                    Gruppi
                  </Link>
                  <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                    <UserCog className="w-4 h-4" />
                    Utenti
                  </Link>
                  {isSuperAdmin && (
                    <Link to="/admin/logs" className={navLinkClass('/admin/logs')}>
                      <Activity className="w-4 h-4" />
                      Log
                    </Link>
                  )}
                  {isSuperAdmin && (
                    <Link to="/admin/audit" className={navLinkClass('/admin/audit')}>
                      <ShieldCheck className="w-4 h-4" />
                      Audit
                    </Link>
                  )}
                  {isSuperAdmin && (
                    <Link to="/admin/personalizza" className={navLinkClass('/admin/personalizza')}>
                      <Palette className="w-4 h-4" />
                      Personalizza
                    </Link>
                  )}
                </>
              )}

              <div className="flex items-center gap-2 ml-3 pl-3 border-l border-gray-100">
                <UserAvatar
                  userId={user?.id}
                  displayName={user?.displayName}
                  email={user?.email}
                  avatarColor={user?.avatarColor}
                  className="w-8 h-8"
                  initialsClassName="text-[10px]"
                />
                <span className="text-sm text-gray-600 hidden lg:block max-w-[140px] truncate">
                  {user?.displayName}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white">
            <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
              <Link to="/" className={mobileNavLinkClass('/')}>
                <Home className="w-4 h-4" />
                Home
              </Link>

              {canUseAdminPages && (
                <>
                  <Link to="/admin" className={mobileNavLinkClass('/admin')}>
                    <Settings className="w-4 h-4" />
                    App
                  </Link>
                  <Link to="/admin/groups" className={mobileNavLinkClass('/admin/groups')}>
                    <Users className="w-4 h-4" />
                    Gruppi
                  </Link>
                  <Link to="/admin/users" className={mobileNavLinkClass('/admin/users')}>
                    <UserCog className="w-4 h-4" />
                    Utenti
                  </Link>
                  {isSuperAdmin && (
                    <Link to="/admin/logs" className={mobileNavLinkClass('/admin/logs')}>
                      <Activity className="w-4 h-4" />
                      Log
                    </Link>
                  )}
                  {isSuperAdmin && (
                    <Link to="/admin/audit" className={mobileNavLinkClass('/admin/audit')}>
                      <ShieldCheck className="w-4 h-4" />
                      Audit
                    </Link>
                  )}
                  {isSuperAdmin && (
                    <Link to="/admin/personalizza" className={mobileNavLinkClass('/admin/personalizza')}>
                      <Palette className="w-4 h-4" />
                      Personalizza
                    </Link>
                  )}
                </>
              )}

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 px-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    userId={user?.id}
                    displayName={user?.displayName}
                    email={user?.email}
                    avatarColor={user?.avatarColor}
                    className="w-9 h-9"
                    initialsClassName="text-[10px]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-dark truncate">{user?.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <LogOut className="w-4 h-4" />
                  Esci
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-dark px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/20 transition-transform hover:-translate-y-0.5 hover:bg-gray-800"
          aria-label="Torna all'inizio della pagina"
        >
          <ArrowUp className="h-4 w-4" />
          Top
        </button>
      )}
    </div>
  );
}
